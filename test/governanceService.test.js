import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '../src/agentStore.js';
import { startAgentRun } from '../src/agentService.js';
import { appendTrace } from '../src/trace/traceStore.js';
import { getGovernanceSnapshot, evaluateRegressionGate } from '../src/governanceService.js';
import { registerWorker } from '../src/workerStore.js';

async function setup(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'governance-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return {
    agentsRoot: path.join(base, 'agents'),
    agentRunsRoot: path.join(base, 'agent-runs'),
    logsRoot: path.join(base, 'logs'),
    tracesRoot: path.join(base, 'traces'),
    workersRoot: path.join(base, 'workers'),
    workflowRunsRoot: path.join(base, 'workflow-runs')
  };
}

test('summarizes runs, workers, traces, and attestation', async (t) => {
  const options = await setup(t);
  await createAgent({ id: 'agent-a', name: 'A', systemPrompt: 'Echo.', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } }, options.agentsRoot);
  const run = await startAgentRun('agent-a', {}, {
    agentsRoot: options.agentsRoot,
    runsRoot: options.agentRunsRoot,
    logsRoot: options.logsRoot,
    tracesRoot: options.tracesRoot,
    startRuntime: async () => ({ pid: 1, cancel() {}, done: Promise.resolve({ code: 0, output: {} }) })
  });
  await appendTrace(run.id, { type: 'policy.denied', riskFlags: ['high'] }, options.tracesRoot);
  await registerWorker({ id: 'worker-a', capabilityTags: ['node:agent'], attestation: { subject: 'worker-a', verified: true, capabilityTags: ['node:agent'] } }, options.workersRoot);

  const snapshot = await getGovernanceSnapshot(options);
  assert.equal(snapshot.workers.attested, 1);
  assert.equal(snapshot.traces.byType['policy.denied'], 1);
  assert.equal(snapshot.regressionGate.passed, false);
});

test('evaluates regression gate limits deterministically', () => {
  assert.deepEqual(evaluateRegressionGate([{ type: 'policy.denied', riskFlags: ['high'] }], { maxHighRisk: 1, maxPolicyDenials: 1 }).passed, true);
  assert.deepEqual(evaluateRegressionGate([{ type: 'policy.denied', riskFlags: ['high'] }], { maxHighRisk: 0, maxPolicyDenials: 0 }).passed, false);
});
