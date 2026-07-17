import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '../src/agentStore.js';
import { delegateAgentRun, getAgentRunTree } from '../src/delegationService.js';
import { startAgentRun, readAgentRun } from '../src/agentService.js';

async function setup(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'delegation-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const options = {
    agentsRoot: path.join(base, 'agents'),
    runsRoot: path.join(base, 'agent-runs'),
    logsRoot: path.join(base, 'logs'),
    tracesRoot: path.join(base, 'traces'),
    pollIntervalMs: 1,
    startRuntime: async ({ input }) => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 0, output: input }) })
  };
  for (const id of ['parent-agent', 'child-agent', 'blocked-agent']) {
    await createAgent({
      id,
      name: id,
      systemPrompt: 'Echo.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { text: { type: 'string' } } }
    }, options.agentsRoot);
  }
  return options;
}

test('delegates an agent run with parent, root, depth, and reason', async (t) => {
  const options = await setup(t);
  const parent = await startAgentRun('parent-agent', { text: 'parent' }, options);
  const child = await delegateAgentRun(parent.id, {
    agentId: 'child-agent',
    input: { text: 'child' },
    reason: 'Need focused implementation.'
  }, { ...options, delegationPolicy: { allowedAgents: ['child-agent'], maxDepth: 2, maxChildrenPerRun: 2 } });
  const stored = await readAgentRun(child.id, options.runsRoot);
  assert.equal(stored.parentRunId, parent.id);
  assert.equal(stored.rootRunId, parent.id);
  assert.equal(stored.depth, 1);
  assert.equal(stored.delegationReason, 'Need focused implementation.');
  await waitForRun(parent.id, options.runsRoot);
  await waitForRun(child.id, options.runsRoot);
});

test('enforces delegate allowlist and depth limits', async (t) => {
  const options = await setup(t);
  const parent = await startAgentRun('parent-agent', {}, options);
  await assert.rejects(delegateAgentRun(parent.id, { agentId: 'blocked-agent', input: {} }, { ...options, delegationPolicy: { allowedAgents: ['child-agent'] } }), (error) => error.code === 'DELEGATION_AGENT_DENIED');
  const child = await delegateAgentRun(parent.id, { agentId: 'child-agent', input: {} }, { ...options, delegationPolicy: { allowedAgents: ['child-agent'], maxDepth: 1 } });
  await assert.rejects(delegateAgentRun(child.id, { agentId: 'child-agent', input: {} }, { ...options, delegationPolicy: { allowedAgents: ['child-agent'], maxDepth: 1 } }), (error) => error.code === 'DELEGATION_DEPTH_EXCEEDED');
  await waitForRun(parent.id, options.runsRoot);
  await waitForRun(child.id, options.runsRoot);
});

test('builds an agent run tree', async (t) => {
  const options = await setup(t);
  const parent = await startAgentRun('parent-agent', {}, options);
  const child = await delegateAgentRun(parent.id, { agentId: 'child-agent', input: {} }, { ...options, delegationPolicy: { allowedAgents: ['child-agent'] } });
  const tree = await getAgentRunTree(parent.id, options);
  assert.equal(tree.id, parent.id);
  assert.equal(tree.children[0].id, child.id);
  await waitForRun(parent.id, options.runsRoot);
  await waitForRun(child.id, options.runsRoot);
});

async function waitForRun(id, root) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const run = await readAgentRun(id, root);
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${id} did not finish.`);
}
