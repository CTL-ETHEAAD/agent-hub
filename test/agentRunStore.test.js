import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentRun, readAgentRun, reconcileAgentRuns, transitionAgentRun } from '../src/agentRunStore.js';

const agent = { id: 'test-agent', version: 1, runtime: { provider: 'fake', model: '' } };

test('persists legal run transitions and protects terminal state', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = await createAgentRun({ agent, input: {} }, root, root);
  await transitionAgentRun(run.id, 'running', { pid: 42 }, root);
  await transitionAgentRun(run.id, 'succeeded', { output: { ok: true } }, root);
  assert.equal((await readAgentRun(run.id, root)).status, 'succeeded');
  await assert.rejects(transitionAgentRun(run.id, 'failed', {}, root), (error) => error.code === 'AGENT_RUN_TRANSITION_INVALID');
});

test('reconciles interrupted runs', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = await createAgentRun({ agent, input: {} }, root, root);
  await transitionAgentRun(run.id, 'running', {}, root);
  await reconcileAgentRuns(root);
  assert.equal((await readAgentRun(run.id, root)).error.code, 'RUN_INTERRUPTED');
});
