import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '../src/agentStore.js';
import { createWorkflow } from '../src/workflowStore.js';
import { createTool } from '../src/toolStore.js';
import { decideWorkflowApproval, readWorkflowRun, resumeWorkflowFromFailure, retryWorkflowRun, startWorkflowRun } from '../src/workflowService.js';
import { readNodeRun } from '../src/nodeRunStore.js';

async function setup(t, workflow) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'workflow-service-')); t.after(() => rm(base, { recursive: true, force: true }));
  const options = { agentsRoot: path.join(base, 'agents'), agentRunsRoot: path.join(base, 'agent-runs'), agentLogsRoot: path.join(base, 'logs'), workflowsRoot: path.join(base, 'workflows'), workflowRunsRoot: path.join(base, 'workflow-runs'), nodeRunsRoot: path.join(base, 'node-runs'), tracesRoot: path.join(base, 'traces'), pollIntervalMs: 1 };
  await createAgent({ id: 'echo-agent', name: 'Echo', systemPrompt: 'Echo.', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }, outputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } }, options.agentsRoot);
  await createWorkflow(workflow, options.workflowsRoot);
  return options;
}

const linear = { id: 'linear-flow', name: 'Linear', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }, nodes: [{ id: 'start', type: 'start' }, { id: 'echo', type: 'agent', agentId: 'echo-agent', input: { text: '$input.text' } }, { id: 'end', type: 'end', output: '$nodes.echo.output' }], edges: [{ from: 'start', to: 'echo' }, { from: 'echo', to: 'end' }] };

test('runs a linear agent workflow and records node output', async (t) => {
  const options = await setup(t, linear);
  options.startRuntime = async ({ input }) => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 0, output: input }) });
  const started = await startWorkflowRun('linear-flow', { text: 'hello' }, options);
  const run = await waitForWorkflow(started.id, options);
  assert.equal(run.status, 'succeeded');
  assert.deepEqual(run.output, { text: 'hello' });
  assert.equal(run.nodes.echo.status, 'succeeded');
  const nodeRun = await readNodeRun(run.nodes.echo.nodeRunId, options.nodeRunsRoot);
  assert.equal(nodeRun.status, 'succeeded');
  assert.deepEqual(nodeRun.input, { text: 'hello' });
  assert.deepEqual(nodeRun.output, { text: 'hello' });
});

test('routes a condition through the matching branch', async (t) => {
  const flow = { id: 'condition-flow', name: 'Condition', inputSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }, nodes: [{ id: 'start', type: 'start' }, { id: 'check', type: 'condition', value: '$input.ok', operator: 'equals', compare: true }, { id: 'yes', type: 'end', output: 'yes' }, { id: 'no', type: 'end', output: 'no' }], edges: [{ from: 'start', to: 'check' }, { from: 'check', to: 'yes', when: true }, { from: 'check', to: 'no', when: false }] };
  const options = await setup(t, flow);
  const started = await startWorkflowRun('condition-flow', { ok: false }, options);
  assert.equal((await waitForWorkflow(started.id, options)).output, 'no');
});

test('fails the workflow when an agent output is invalid', async (t) => {
  const options = await setup(t, linear);
  options.startRuntime = async () => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 0, output: { nope: true } }) });
  const started = await startWorkflowRun('linear-flow', { text: 'hello' }, options);
  const run = await waitForWorkflow(started.id, options);
  assert.equal(run.status, 'failed');
  assert.equal(run.nodes.echo.status, 'failed');
});

test('pauses for approval and resumes from the next node', async (t) => {
  const flow = { id: 'approval-flow', name: 'Approval', nodes: [{ id: 'start', type: 'start' }, { id: 'approve', type: 'approval', prompt: 'Continue?' }, { id: 'end', type: 'end', output: '$nodes.approve.output' }], edges: [{ from: 'start', to: 'approve' }, { from: 'approve', to: 'end' }] };
  const options = await setup(t, flow);
  const started = await startWorkflowRun('approval-flow', {}, options);
  const waiting = await waitForStatus(started.id, 'waiting_approval', options);
  assert.equal(waiting.currentNodeId, 'approve');
  await decideWorkflowApproval(started.id, { approved: true, note: 'Looks good' }, options);
  const done = await waitForWorkflow(started.id, options);
  assert.equal(done.output.note, 'Looks good');
});

test('retries a failed workflow as a new run with a snapshot', async (t) => {
  const options = await setup(t, linear);
  options.startRuntime = async () => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 1, error: 'boom' }) });
  const started = await startWorkflowRun('linear-flow', { text: 'hello' }, options);
  const failed = await waitForWorkflow(started.id, options);
  options.startRuntime = async ({ input }) => ({ pid: 2, cancel() {}, done: Promise.resolve({ code: 0, output: input }) });
  const retry = await retryWorkflowRun(failed.id, options);
  const done = await waitForWorkflow(retry.id, options);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.retryOf, failed.id);
});

test('enforces agent run budget and records audit events', async (t) => {
  const flow = { ...linear, id: 'budget-flow', limits: { maxDurationMs: 60000, maxAgentRuns: 0 } };
  const options = await setup(t, flow);
  options.startRuntime = async ({ input }) => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 0, output: input }) });
  const started = await startWorkflowRun('budget-flow', { text: 'hello' }, options);
  const failed = await waitForWorkflow(started.id, options);
  assert.equal(failed.error.code, 'WORKFLOW_AGENT_BUDGET_EXCEEDED');
  assert.ok(failed.events.some((event) => event.type === 'node.failed'));
  assert.ok(failed.events.some((event) => event.type === 'run.failed'));
});

test('retries an agent node according to node policy', async (t) => {
  const flow = structuredClone(linear);
  flow.id = 'retry-node-flow';
  flow.nodes.find((node) => node.id === 'echo').retry = { maxAttempts: 2, delayMs: 0 };
  const options = await setup(t, flow);
  let attempts = 0;
  options.startRuntime = async ({ input }) => {
    attempts += 1;
    return { pid: attempts, cancel() {}, done: Promise.resolve(attempts === 1 ? { code: 1, error: 'temporary' } : { code: 0, output: input }) };
  };
  const started = await startWorkflowRun('retry-node-flow', { text: 'hello' }, options);
  const done = await waitForWorkflow(started.id, options);
  assert.equal(done.status, 'succeeded');
  assert.equal(attempts, 2);
  assert.ok(done.events.some((event) => event.type === 'node.retry_scheduled'));
});

test('executes a registered tool node with mapped input', async (t) => {
  const flow = { id: 'tool-flow', name: 'Tool', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, nodes: [{ id: 'start', type: 'start' }, { id: 'lookup', type: 'tool', toolId: 'lookup-tool', input: { id: '$input.id' } }, { id: 'end', type: 'end', output: '$nodes.lookup.output' }], edges: [{ from: 'start', to: 'lookup' }, { from: 'lookup', to: 'end' }] };
  const options = await setup(t, flow);
  options.toolsRoot = path.join(path.dirname(options.workflowsRoot), 'tools');
  await createTool({ id: 'lookup-tool', name: 'Lookup', type: 'http', config: { url: 'https://api.example.com/items/{{id}}', method: 'GET', allowedHosts: ['api.example.com'] }, inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, outputSchema: { type: 'object', required: ['found'], properties: { found: { type: 'boolean' } } } }, options.toolsRoot);
  options.fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"found":true}' });
  const started = await startWorkflowRun('tool-flow', { id: '42' }, options);
  const done = await waitForWorkflow(started.id, options);
  assert.deepEqual(done.output, { found: true });
});

test('executes parallel branches and joins their outputs', async (t) => {
  const flow = { id: 'parallel-flow', name: 'Parallel', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }, nodes: [{ id: 'start', type: 'start' }, { id: 'fanout', type: 'parallel', joinId: 'join' }, { id: 'a', type: 'agent', agentId: 'echo-agent', input: { text: '$input.text' } }, { id: 'b', type: 'agent', agentId: 'echo-agent', input: { text: '$input.text' } }, { id: 'join', type: 'join' }, { id: 'end', type: 'end', output: '$nodes.join.output' }], edges: [{ from: 'start', to: 'fanout' }, { from: 'fanout', to: 'a', label: 'analysis' }, { from: 'fanout', to: 'b', label: 'security' }, { from: 'a', to: 'join' }, { from: 'b', to: 'join' }, { from: 'join', to: 'end' }] };
  const options = await setup(t, flow);
  options.startRuntime = async ({ input }) => ({ pid: Math.random(), cancel() {}, done: Promise.resolve({ code: 0, output: input }) });
  const started = await startWorkflowRun('parallel-flow', { text: 'hello' }, options);
  const done = await waitForWorkflow(started.id, options);
  assert.deepEqual(done.output, { analysis: { text: 'hello' }, security: { text: 'hello' } });
  assert.equal(done.nodes.join.status, 'succeeded');
});

test('records the failed parallel branch and requires a full retry', async (t) => {
  const flow = { id: 'parallel-failure', name: 'Parallel failure', inputSchema: { type: 'object', properties: {} }, nodes: [{ id: 'start', type: 'start' }, { id: 'fanout', type: 'parallel', joinId: 'join' }, { id: 'a', type: 'agent', agentId: 'echo-agent', input: {} }, { id: 'b', type: 'agent', agentId: 'echo-agent', input: {} }, { id: 'join', type: 'join' }, { id: 'end', type: 'end' }], edges: [{ from: 'start', to: 'fanout' }, { from: 'fanout', to: 'a' }, { from: 'fanout', to: 'b' }, { from: 'a', to: 'join' }, { from: 'b', to: 'join' }, { from: 'join', to: 'end' }] };
  const options = await setup(t, flow);
  options.startRuntime = async () => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 1, error: 'branch failed' }) });
  const failed = await waitForWorkflow((await startWorkflowRun('parallel-failure', {}, options)).id, options);
  assert.equal(failed.status, 'failed');
  assert.ok(['a', 'b'].some((id) => failed.nodes[id].status === 'failed'));
  await assert.rejects(resumeWorkflowFromFailure(failed.id, options), (error) => error.code === 'PARALLEL_RESUME_UNSAFE');
});

test('runs a reusable subworkflow and returns its output', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'subworkflow-')); t.after(() => rm(base, { recursive: true, force: true }));
  const options = { agentsRoot: path.join(base, 'agents'), agentRunsRoot: path.join(base, 'agent-runs'), agentLogsRoot: path.join(base, 'logs'), workflowsRoot: path.join(base, 'workflows'), workflowRunsRoot: path.join(base, 'workflow-runs'), nodeRunsRoot: path.join(base, 'node-runs'), tracesRoot: path.join(base, 'traces'), pollIntervalMs: 1 };
  await createAgent({ id: 'echo-agent', name: 'Echo', systemPrompt: 'Echo.', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }, outputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } }, options.agentsRoot);
  await createWorkflow({ id: 'child-flow', name: 'Child', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }, nodes: [{ id: 'start', type: 'start' }, { id: 'echo', type: 'agent', agentId: 'echo-agent', input: { text: '$input.text' } }, { id: 'end', type: 'end', output: '$nodes.echo.output' }], edges: [{ from: 'start', to: 'echo' }, { from: 'echo', to: 'end' }] }, options.workflowsRoot);
  await createWorkflow({ id: 'parent-flow', name: 'Parent', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }, nodes: [{ id: 'start', type: 'start' }, { id: 'child', type: 'subworkflow', workflowId: 'child-flow', input: { text: '$input.text' } }, { id: 'end', type: 'end', output: '$nodes.child.output' }], edges: [{ from: 'start', to: 'child' }, { from: 'child', to: 'end' }] }, options.workflowsRoot);
  options.startRuntime = async ({ input }) => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 0, output: input }) });
  const started = await startWorkflowRun('parent-flow', { text: 'nested' }, options);
  assert.deepEqual((await waitForWorkflow(started.id, options)).output, { text: 'nested' });
});

test('resumes from the failed node while reusing successful upstream nodes', async (t) => {
  const options = await setup(t, linear);
  options.startRuntime = async () => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 1, error: 'temporary' }) });
  const failed = await waitForWorkflow((await startWorkflowRun('linear-flow', { text: 'resume' }, options)).id, options);
  options.startRuntime = async ({ input }) => ({ pid: 2, cancel() {}, done: Promise.resolve({ code: 0, output: input }) });
  const resumed = await resumeWorkflowFromFailure(failed.id, options);
  const done = await waitForWorkflow(resumed.id, options);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.resumedFromNodeId, 'echo');
  assert.equal(done.nodes.start.status, 'succeeded');
  assert.ok(done.events.some((event) => event.type === 'run.resumed_from_node'));
});

test('returns the existing run for the same idempotency key', async (t) => {
  const options = await setup(t, linear);
  options.startRuntime = async ({ input }) => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 0, output: input }) });
  const first = await startWorkflowRun('linear-flow', { text: 'once' }, { ...options, idempotencyKey: 'request-1' });
  await waitForWorkflow(first.id, options);
  const second = await startWorkflowRun('linear-flow', { text: 'once' }, { ...options, idempotencyKey: 'request-1' });
  assert.equal(second.id, first.id);
});

async function waitForWorkflow(id, options) {
  for (let i = 0; i < 100; i += 1) {
    const run = await readWorkflowRun(id, options.workflowRunsRoot);
    if (['succeeded', 'failed'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('workflow did not finish');
}

async function waitForStatus(id, status, options) {
  for (let i = 0; i < 100; i += 1) {
    const run = await readWorkflowRun(id, options.workflowRunsRoot);
    if (run.status === status) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`workflow did not reach ${status}`);
}
