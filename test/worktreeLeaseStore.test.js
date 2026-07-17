import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acquireWorktreeLease,
  deriveWorktreeKey,
  listWorktreeLeases,
  recoverExpiredWorktreeLeases,
  releaseWorktreeLease
} from '../src/sandbox/worktreeLeaseStore.js';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worktree-leases-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('prevents two active node runs from leasing the same worktree', async (t) => {
  const root = await setup(t);
  const worktreeKey = deriveWorktreeKey({ workflowId: 'wf', nodeId: 'agent-a', repo: 'repo-a', strategy: 'fresh-per-node' });
  await acquireWorktreeLease({ worktreeKey, nodeRunId: 'nrun_11111111-1111-4111-8111-111111111111', workerId: 'worker-a' }, root);
  await assert.rejects(
    acquireWorktreeLease({ worktreeKey, nodeRunId: 'nrun_22222222-2222-4222-8222-222222222222', workerId: 'worker-b' }, root),
    (error) => error.code === 'WORKTREE_LEASE_CONFLICT'
  );
});

test('allows a worktree lease to be reacquired after release', async (t) => {
  const root = await setup(t);
  const worktreeKey = deriveWorktreeKey({ workflowId: 'wf', nodeId: 'agent-a', repo: 'repo-a', strategy: 'fresh-per-node' });
  await acquireWorktreeLease({ worktreeKey, nodeRunId: 'nrun_11111111-1111-4111-8111-111111111111' }, root);
  await releaseWorktreeLease(worktreeKey, { nodeRunId: 'nrun_11111111-1111-4111-8111-111111111111' }, root);
  const lease = await acquireWorktreeLease({ worktreeKey, nodeRunId: 'nrun_22222222-2222-4222-8222-222222222222' }, root);
  assert.equal(lease.status, 'active');
  assert.equal(lease.nodeRunId, 'nrun_22222222-2222-4222-8222-222222222222');
});

test('recovers expired active worktree leases', async (t) => {
  const root = await setup(t);
  const worktreeKey = deriveWorktreeKey({ workflowId: 'wf', nodeId: 'agent-a', repo: 'repo-a', strategy: 'fresh-per-node' });
  await acquireWorktreeLease({ worktreeKey, nodeRunId: 'nrun_11111111-1111-4111-8111-111111111111', ttlMs: 1 }, root);
  const recovered = await recoverExpiredWorktreeLeases({ now: new Date(Date.now() + 1000) }, root);
  assert.equal(recovered.length, 1);
  assert.equal((await listWorktreeLeases({ status: 'released' }, root)).length, 1);
});
