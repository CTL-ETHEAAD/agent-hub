import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '../src/agentStore.js';
import { createNodeRun, readNodeRun, transitionNodeRun, updateNodeRun } from '../src/nodeRunStore.js';
import { createTool } from '../src/toolStore.js';
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
    workersRoot: path.join(base, 'workers'),
    agentsRoot: path.join(base, 'agents'),
    agentRunsRoot: path.join(base, 'agent-runs'),
    agentLogsRoot: path.join(base, 'agent-logs'),
    toolsRoot: path.join(base, 'tools'),
    tracesRoot: path.join(base, 'traces')
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
  const run = await createNodeRun({ workflowRun, node: { id: 'child-a', type: 'subworkflow' }, input: {} }, options.nodeRunsRoot);
  const result = await runWorkerOnce({ ...options, workerId: 'worker-unsupported' });
  assert.equal(result.results.length, 1);
  const failed = await readNodeRun(run.id, options.nodeRunsRoot);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'NODE_HANDLER_UNSUPPORTED');
});

test('worker executes an agent node through the agent service', async (t) => {
  const options = await setup(t);
  await createAgent({
    id: 'echo-agent',
    name: 'Echo',
    systemPrompt: 'Echo.',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }
  }, options.agentsRoot);
  const run = await createNodeRun({
    workflowRun,
    node: { id: 'agent-a', type: 'agent', agentId: 'echo-agent' },
    input: { text: 'from worker' }
  }, options.nodeRunsRoot);
  const result = await runWorkerOnce({
    ...options,
    workerId: 'worker-agent',
    startRuntime: async ({ input }) => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 0, output: input }) }),
    pollIntervalMs: 1
  });
  assert.equal(result.results.length, 1);
  const completed = await readNodeRun(run.id, options.nodeRunsRoot);
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.output, { text: 'from worker' });
});

test('worker executes a tool node through the tool service', async (t) => {
  const options = await setup(t);
  await createTool({
    id: 'lookup-tool',
    name: 'Lookup',
    type: 'http',
    config: { url: 'https://api.example.com/items/{{id}}', method: 'GET', allowedHosts: ['api.example.com'] },
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    outputSchema: { type: 'object', required: ['found'], properties: { found: { type: 'boolean' } } }
  }, options.toolsRoot);
  const run = await createNodeRun({
    workflowRun,
    node: { id: 'tool-a', type: 'tool', toolId: 'lookup-tool' },
    input: { id: '42' }
  }, options.nodeRunsRoot);
  const result = await runWorkerOnce({
    ...options,
    workerId: 'worker-tool',
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"found":true}' })
  });
  assert.equal(result.results.length, 1);
  const completed = await readNodeRun(run.id, options.nodeRunsRoot);
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.output, { found: true });
});

async function updateStaleWorker(id, workersRoot) {
  return updateWorker(id, { heartbeatAt: new Date(Date.now() - 10_000).toISOString() }, workersRoot);
}
