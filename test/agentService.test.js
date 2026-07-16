import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '../src/agentStore.js';
import { cancelAgentRun, readAgentRun, startAgentRun } from '../src/agentService.js';
import { listTraces } from '../src/trace/traceStore.js';

const definition = { id: 'echo-agent', name: 'Echo', systemPrompt: 'Echo.', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }, outputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } };

async function setup(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'service-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const options = { agentsRoot: path.join(base, 'agents'), runsRoot: path.join(base, 'runs'), logsRoot: path.join(base, 'logs'), tracesRoot: path.join(base, 'traces') };
  await createAgent(definition, options.agentsRoot);
  return options;
}

test('validates input before starting runtime', async (t) => {
  const options = await setup(t);
  let started = false;
  await assert.rejects(startAgentRun('echo-agent', {}, { ...options, startRuntime: async () => { started = true; } }), (error) => error.code === 'AGENT_INPUT_INVALID');
  assert.equal(started, false);
});

test('records successful structured output', async (t) => {
  const options = await setup(t);
  const run = await startAgentRun('echo-agent', { text: 'hi' }, { ...options, startRuntime: async () => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 0, output: { text: 'hi' } }) }) });
  const completed = await waitForRun(run.id, 'succeeded', options.runsRoot);
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(
    await waitForTraceTypes(run.id, ['agent.run.queued', 'agent.run.started', 'agent.run.completed'], options.tracesRoot),
    ['agent.run.queued', 'agent.run.started', 'agent.run.completed'],
  );
});

async function waitForRun(id, status, root) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const run = await readAgentRun(id, root);
    if (run.status === status) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${id} did not reach ${status}.`);
}

async function waitForTraceTypes(id, expected, root) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const types = (await listTraces(id, root)).map((event) => event.type);
    if (expected.every((type) => types.includes(type))) return types;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return (await listTraces(id, root)).map((event) => event.type);
}

test('cancels an active run', async (t) => {
  const options = await setup(t);
  let cancelled = false;
  const run = await startAgentRun('echo-agent', { text: 'hi' }, { ...options, startRuntime: async () => ({ pid: 1, cancel() { cancelled = true; }, done: new Promise(() => {}) }) });
  const result = await cancelAgentRun(run.id, options);
  assert.equal(result.status, 'cancelled');
  assert.equal(cancelled, true);
});
