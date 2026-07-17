import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import {
  claimNextNodeRun,
  recoverExpiredNodeRuns,
  renewNodeRunLease,
  transitionNodeRun
} from './nodeRunStore.js';
import { completeNodeRun, failNodeRun } from './nodeRunService.js';
import {
  assignNodeRunToWorker,
  heartbeatWorker,
  markStaleWorkers,
  registerWorker,
  releaseNodeRunFromWorker
} from './workerStore.js';

const DEFAULT_CAPABILITIES = ['node:start', 'node:condition', 'node:end'];

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
  throw workerError(`No worker handler is registered for node type ${nodeRun.nodeType}.`, 'NODE_HANDLER_UNSUPPORTED', 501);
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
