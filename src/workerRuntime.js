import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import {
  claimNextNodeRun,
  recoverExpiredNodeRuns,
  renewNodeRunLease,
  transitionNodeRun
} from './nodeRunStore.js';
import { completeNodeRun, failNodeRun } from './nodeRunService.js';
import { readAgentRun, startAgentRun } from './agentService.js';
import { executeTool } from './toolService.js';
import {
  assignNodeRunToWorker,
  heartbeatWorker,
  markStaleWorkers,
  registerWorker,
  releaseNodeRunFromWorker
} from './workerStore.js';

const DEFAULT_CAPABILITIES = ['node:start', 'node:condition', 'node:end', 'node:agent', 'node:tool'];

export async function runSchedulerOnce(options = {}) {
  const interruptedNodeRuns = await recoverExpiredNodeRuns({ now: options.now || new Date() }, options.nodeRunsRoot);
  const staleWorkers = await markStaleWorkers({ now: options.now || new Date(), staleAfterMs: options.staleAfterMs || 60_000 }, options.workersRoot);
  return { interruptedNodeRuns, staleWorkers };
}

export async function runWorkerOnce(options = {}) {
  const worker = await ensureWorker(options);
  await heartbeatWorker(worker.id, {}, options.workersRoot);
  const slots = Math.max(1, Number(options.concurrencySlots || worker.concurrencySlots || 1));
  const results = [];
  for (let index = 0; index < slots; index += 1) {
    const claimed = await claimNextNodeRun({ workerId: worker.id, leaseMs: options.leaseMs || worker.leaseMs || 30_000 }, options.nodeRunsRoot);
    if (!claimed) break;
    results.push(await executeClaimedNodeRun(claimed, { ...options, workerId: worker.id }));
  }
  return { workerId: worker.id, results };
}

export async function runWorkerLoop(options = {}) {
  const intervalMs = options.intervalMs || 1000;
  while (!options.signal?.aborted) {
    const result = await runWorkerOnce(options);
    if (options.log !== false) console.log(JSON.stringify({ type: 'worker.tick', workerId: result.workerId, completed: result.results.length, at: new Date().toISOString() }));
    await delay(result.results.length ? 0 : intervalMs, undefined, { signal: options.signal }).catch((error) => {
      if (error.name !== 'AbortError') throw error;
    });
  }
}

async function executeClaimedNodeRun(nodeRun, options) {
  await assignNodeRunToWorker(options.workerId, nodeRun.id, options.workersRoot);
  let running = nodeRun;
  try {
    running = await transitionNodeRun(nodeRun.id, 'running', {}, options.nodeRunsRoot);
    if (options.renewBeforeExecute !== false) await renewNodeRunLease(running.id, { workerId: options.workerId, leaseMs: options.leaseMs || 30_000 }, options.nodeRunsRoot);
    const output = await executeNodeRunHandler(running, options);
    return await completeNodeRun(running.id, output, options);
  } catch (error) {
    return failNodeRun(running.id, error, options);
  } finally {
    await releaseNodeRunFromWorker(options.workerId, nodeRun.id, options.workersRoot).catch(() => {});
  }
}

async function executeNodeRunHandler(nodeRun, options) {
  const injected = options.handlers?.[nodeRun.nodeType];
  if (injected) return injected(nodeRun, options);
  if (nodeRun.nodeType === 'start' || nodeRun.nodeType === 'end') return structuredClone(nodeRun.input);
  if (nodeRun.nodeType === 'condition') return evaluateConditionNode(nodeRun.nodeSnapshot, nodeRun.input);
  if (nodeRun.nodeType === 'agent') return executeAgentNodeRun(nodeRun, options);
  if (nodeRun.nodeType === 'tool') return executeToolNodeRun(nodeRun, options);
  throw workerError(`No worker handler is registered for node type ${nodeRun.nodeType}.`, 'NODE_HANDLER_UNSUPPORTED', 501);
}

async function executeAgentNodeRun(nodeRun, options) {
  const node = nodeRun.nodeSnapshot;
  if (!node.agentId) throw workerError('Agent node is missing agentId.', 'NODE_AGENT_ID_MISSING', 422);
  const agentRun = await startAgentRun(node.agentId, nodeRun.input || {}, {
    version: node.agentVersion,
    agentsRoot: options.agentsRoot,
    runsRoot: options.agentRunsRoot,
    logsRoot: options.agentLogsRoot,
    tracesRoot: options.tracesRoot,
    startRuntime: options.startRuntime
  });
  const completed = await waitForAgentRun(agentRun.id, options);
  if (completed.status !== 'succeeded') throw workerError(completed.error?.message || 'Agent node failed.', completed.error?.code || 'NODE_AGENT_FAILED', 500);
  return completed.output;
}

async function executeToolNodeRun(nodeRun, options) {
  const node = nodeRun.nodeSnapshot;
  if (!node.toolId) throw workerError('Tool node is missing toolId.', 'NODE_TOOL_ID_MISSING', 422);
  const result = await executeTool(node.toolId, nodeRun.input || {}, {
    version: node.toolVersion,
    toolsRoot: options.toolsRoot,
    policiesRoot: options.policiesRoot,
    policies: options.policies,
    fetchImpl: options.fetchImpl,
    env: options.env,
    mode: 'workflow',
    compatibilityMode: options.policyCompatibilityMode !== false,
    runContext: {
      runId: nodeRun.workflowRunId,
      nodeId: nodeRun.nodeId,
      workflowId: nodeRun.workflowId,
      userId: options.userId || 'user_local'
    }
  });
  return result.output;
}

async function waitForAgentRun(id, options) {
  const deadline = Date.now() + (options.agentRunTimeoutMs || 30 * 60 * 1000);
  while (Date.now() < deadline) {
    const run = await readAgentRun(id, options.agentRunsRoot);
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;
    await delay(options.pollIntervalMs || 25);
  }
  throw workerError(`Agent run ${id} timed out.`, 'NODE_AGENT_TIMEOUT', 408);
}

async function ensureWorker(options) {
  const workerId = options.workerId || `worker:${os.hostname()}:${process.pid}`;
  return registerWorker({
    id: workerId,
    role: 'worker',
    capabilityTags: options.capabilityTags || DEFAULT_CAPABILITIES,
    concurrencySlots: options.concurrencySlots || 1,
    leaseMs: options.leaseMs || 30_000
  }, options.workersRoot);
}

function evaluateConditionNode(node, input) {
  const value = input?.value;
  if (node.operator === 'equals') return Object.is(value, node.compare);
  if (node.operator === 'notEquals') return !Object.is(value, node.compare);
  if (node.operator === 'exists') return value !== undefined && value !== null;
  return false;
}

function workerError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
