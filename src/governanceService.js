import { listAgentRuns } from './agentService.js';
import { listWorkflowRuns } from './workflowService.js';
import { listWorkers } from './workerStore.js';
import { listTraceRunIds, listTraces } from './trace/traceStore.js';

export async function getGovernanceSnapshot(options = {}) {
  const [agentRuns, workflowRuns, workers, traceRunIds] = await Promise.all([
    listAgentRuns({}, options.agentRunsRoot),
    listWorkflowRuns({}, options.workflowRunsRoot),
    listWorkers({}, options.workersRoot),
    listTraceRunIds(options.tracesRoot)
  ]);
  const traces = (await Promise.all(traceRunIds.map((id) => listTraces(id, options.tracesRoot)))).flat();
  return {
    generatedAt: new Date().toISOString(),
    runs: summarizeRuns(agentRuns, workflowRuns),
    workers: summarizeWorkers(workers),
    traces: summarizeTraces(traces),
    regressionGate: evaluateRegressionGate(traces, options.regressionGate || {})
  };
}

export function evaluateRegressionGate(traces, gate = {}) {
  const maxHighRisk = Number.isInteger(gate.maxHighRisk) ? gate.maxHighRisk : 0;
  const maxPolicyDenials = Number.isInteger(gate.maxPolicyDenials) ? gate.maxPolicyDenials : 0;
  const highRisk = traces.filter((trace) => (trace.riskFlags || []).some((flag) => ['high', 'critical'].includes(flag))).length;
  const policyDenials = traces.filter((trace) => trace.type === 'policy.denied').length;
  return {
    passed: highRisk <= maxHighRisk && policyDenials <= maxPolicyDenials,
    highRisk,
    policyDenials,
    limits: { maxHighRisk, maxPolicyDenials }
  };
}

function summarizeRuns(agentRuns, workflowRuns) {
  return {
    agent: countByStatus(agentRuns),
    workflow: countByStatus(workflowRuns),
    delegatedAgentRuns: agentRuns.filter((run) => run.parentRunId).length
  };
}

function summarizeWorkers(workers) {
  return {
    total: workers.length,
    byStatus: countByStatus(workers),
    attested: workers.filter((worker) => worker.attestation?.verified).length,
    unattested: workers.filter((worker) => !worker.attestation?.verified).length,
    capabilities: [...new Set(workers.flatMap((worker) => worker.capabilityTags || []))].sort()
  };
}

function summarizeTraces(traces) {
  return {
    total: traces.length,
    byType: traces.reduce((acc, trace) => ({ ...acc, [trace.type]: (acc[trace.type] || 0) + 1 }), {})
  };
}

function countByStatus(items) {
  return items.reduce((acc, item) => ({ ...acc, [item.status || 'unknown']: (acc[item.status || 'unknown'] || 0) + 1 }), {});
}
