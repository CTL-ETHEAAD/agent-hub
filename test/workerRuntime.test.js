import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNodeRun, readNodeRun, transitionNodeRun, updateNodeRun } from '../src/nodeRunStore.js';
import { runSchedulerOnce, runWorkerOnce } from '../src/workerRuntime.js';
import { listWorkers, registerWorker, updateWorker } from '../src/workerStore.js';

const workflowRun = {
  id: 'wrun_22222222-2222-4222-8222-222222222222',
  workflowId: 'worker-flow',
  workflowVersion: 1
};

async function setup(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'worker-runtime-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return {
    nodeRunsRoot: path.join(base, 'node-runs'),
    workersRoot: path.join(base, 'workers')
  };
}

test('two workers consume different queued node runs', async (t) => {
  const options = await setup(t);
  const nodeA = await createNodeRun({ workflowRun, node: { id: 'a', type: 'agent' }, input: { text: 'a' } }, options.nodeRunsRoot);
  const nodeB = await createNodeRun({ workflowRun, node: { id: 'b', type: 'agent' }, input: { text: 'b' } }, options.nodeRunsRoot);
  const handlers = { agent: async (run) => ({ workerInput: run.input.text }) };

  const first = await runWorkerOnce({ ...options, workerId: 'worker-a', handlers });
  const second = await runWorkerOnce({ ...options, workerId: 'worker-b', handlers });

  assert.equal(first.results.length, 1);
  assert.equal(second.results.length, 1);
  assert.notEqual(first.results[0].id, second.results[0].id);
  assert.equal((await readNodeRun(nodeA.id, options.nodeRunsRoot)).status, 'succeeded');
  assert.equal((await readNodeRun(nodeB.id, options.nodeRunsRoot)).status, 'succeeded');
});

test('worker respects local concurrency slots', async (t) => {
  const options = await setup(t);
  await createNodeRun({ workflowRun, node: { id: 'a', type: 'agent' }, input: { text: 'a' } }, options.nodeRunsRoot);
  await createNodeRun({ workflowRun, node: { id: 'b', type: 'agent' }, input: { text: 'b' } }, options.nodeRunsRoot);
  const result = await runWorkerOnce({
    ...options,
    workerId: 'worker-concurrent',
    concurrencySlots: 2,
    handlers: { agent: async (run) => run.input }
  });
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every((run) => run.status === 'succeeded'));
});

test('scheduler interrupts expired node run leases and marks stale workers', async (t) => {
  const options = await setup(t);
  const run = await createNodeRun({ workflowRun, node: { id: 'tool-a', type: 'tool' }, input: {} }, options.nodeRunsRoot);
  await transitionNodeRun(run.id, 'claimed', { workerId: 'worker-stale', leaseExpiresAt: new Date(Date.now() - 10_000).toISOString() }, options.nodeRunsRoot);
  await registerWorker({ id: 'worker-stale', concurrencySlots: 1 }, options.workersRoot);
  await updateStaleWorker('worker-stale', options.workersRoot);

  const result = await runSchedulerOnce({ ...options, staleAfterMs: 1000 });
  assert.equal(result.interruptedNodeRuns.length, 1);
  assert.equal(result.staleWorkers.length, 1);
  assert.equal((await readNodeRun(run.id, options.nodeRunsRoot)).error.code, 'NODE_RUN_LEASE_EXPIRED');
  assert.equal((await listWorkers({ status: 'stale' }, options.workersRoot)).length, 1);
});

test('worker fails unsupported node types without crashing', async (t) => {
  const options = await setup(t);
  const run = await createNodeRun({ workflowRun, node: { id: 'tool-a', type: 'tool' }, input: {} }, options.nodeRunsRoot);
  const result = await runWorkerOnce({ ...options, workerId: 'worker-unsupported' });
  assert.equal(result.results.length, 1);
  const failed = await readNodeRun(run.id, options.nodeRunsRoot);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'NODE_HANDLER_UNSUPPORTED');
});

async function updateStaleWorker(id, workersRoot) {
  return updateWorker(id, { heartbeatAt: new Date(Date.now() - 10_000).toISOString() }, workersRoot);
}
