import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  claimNodeRun,
  createNodeRun,
  listNodeRuns,
  readNodeRun,
  reconcileNodeRuns,
  renewNodeRunLease,
  transitionNodeRun
} from '../src/nodeRunStore.js';
import { completeNodeRun, failNodeRun, setNodeRunInput, startNodeRun } from '../src/nodeRunService.js';

const workflowRun = {
  id: 'wrun_11111111-1111-4111-8111-111111111111',
  workflowId: 'demo-flow',
  workflowVersion: 3
};
const node = { id: 'agent-1', type: 'agent', agentId: 'agent-a', input: { text: '$input.text' } };

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'node-runs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('creates node runs idempotently by workflow node attempt', async (t) => {
  const root = await setup(t);
  const first = await createNodeRun({ workflowRun, node, input: { text: 'hello' }, idempotencyKey: 'same-key' }, root);
  const second = await createNodeRun({ workflowRun, node, input: { text: 'hello again' }, idempotencyKey: 'same-key' }, root);
  assert.equal(second.id, first.id);
  assert.equal((await listNodeRuns({ workflowRunId: workflowRun.id }, root)).length, 1);
});

test('claims, renews, runs, and completes a node run', async (t) => {
  const root = await setup(t);
  const created = await createNodeRun({ workflowRun, node, maxAttempts: 2 }, root);
  const claimed = await claimNodeRun(created.id, { workerId: 'worker-a', leaseMs: 1000 }, root);
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.workerId, 'worker-a');
  const renewed = await renewNodeRunLease(created.id, { workerId: 'worker-a', leaseMs: 2000 }, root);
  assert.ok(renewed.leaseExpiresAt);
  await transitionNodeRun(created.id, 'running', {}, root);
  await setNodeRunInput(created.id, { text: 'hello' }, { nodeRunsRoot: root });
  const completed = await completeNodeRun(created.id, { ok: true }, { nodeRunsRoot: root });
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.output, { ok: true });
  await assert.rejects(transitionNodeRun(created.id, 'running', {}, root), (error) => error.code === 'NODE_RUN_TRANSITION_INVALID');
});

test('marks active node runs interrupted during reconciliation', async (t) => {
  const root = await setup(t);
  const run = await startNodeRun({ workflowRun, node }, { nodeRunsRoot: root });
  assert.equal(run.status, 'running');
  const [interrupted] = await reconcileNodeRuns(root);
  assert.equal(interrupted.status, 'interrupted');
  assert.equal((await readNodeRun(run.id, root)).error.code, 'NODE_RUN_INTERRUPTED');
});

test('records failed node run errors', async (t) => {
  const root = await setup(t);
  const run = await startNodeRun({ workflowRun, node }, { nodeRunsRoot: root });
  const error = new Error('boom');
  error.code = 'TEST_FAILURE';
  const failed = await failNodeRun(run.id, error, { nodeRunsRoot: root });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'TEST_FAILURE');
});
