import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_ROOT } from './stateStore.js';

export const NODE_RUNS_ROOT = process.env.AGENT_HUB_NODE_RUNS_ROOT || path.join(STATE_ROOT, 'node-runs');

const queues = new Map();
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const TRANSITIONS = {
  queued: new Set(['claimed', 'running', 'waiting', 'succeeded', 'failed', 'cancelled', 'interrupted']),
  claimed: new Set(['queued', 'running', 'failed', 'cancelled', 'interrupted']),
  running: new Set(['waiting', 'succeeded', 'failed', 'cancelled', 'interrupted']),
  waiting: new Set(['running', 'succeeded', 'failed', 'cancelled', 'interrupted'])
};

export class NodeRunStoreError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'NodeRunStoreError';
    this.code = code;
    this.status = status;
  }
}

export async function createNodeRun({ workflowRun, node, input = null, attempt = 1, maxAttempts = 1, idempotencyKey = '' }, root = NODE_RUNS_ROOT) {
  if (idempotencyKey) {
    const existing = (await listNodeRuns({ workflowRunId: workflowRun.id }, root)).find((run) => run.idempotencyKey === idempotencyKey);
    if (existing) return structuredClone(existing);
  }
  const now = new Date().toISOString();
  const run = {
    id: `nrun_${randomUUID()}`,
    workflowRunId: workflowRun.id,
    workflowId: workflowRun.workflowId,
    workflowVersion: workflowRun.workflowVersion,
    nodeId: node.id,
    nodeType: node.type,
    nodeSnapshot: structuredClone(node),
    status: 'queued',
    attempt,
    maxAttempts,
    idempotencyKey,
    input: structuredClone(input),
    inputRef: null,
    output: null,
    outputRef: null,
    error: null,
    workerId: null,
    leaseExpiresAt: null,
    createdAt: now,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    events: [{ type: 'node_run.created', at: now, status: 'queued', attempt }]
  };
  await atomicWrite(runPath(run.id, root), run);
  return structuredClone(run);
}

export async function readNodeRun(id, root = NODE_RUNS_ROOT) {
  assertRunId(id);
  try {
    return structuredClone(JSON.parse(await readFile(runPath(id, root), 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') throw new NodeRunStoreError(`Node run ${id} was not found.`, 'NODE_RUN_NOT_FOUND', 404);
    throw error;
  }
}

export async function listNodeRuns({ workflowRunId, workflowId, nodeId, status } = {}, root = NODE_RUNS_ROOT) {
  await mkdir(root, { recursive: true });
  const names = (await readdir(root)).filter((name) => name.endsWith('.json'));
  const runs = await Promise.all(names.map((name) => readNodeRun(name.slice(0, -5), root)));
  return runs
    .filter((run) => !workflowRunId || run.workflowRunId === workflowRunId)
    .filter((run) => !workflowId || run.workflowId === workflowId)
    .filter((run) => !nodeId || run.nodeId === nodeId)
    .filter((run) => !status || run.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateNodeRun(id, update, root = NODE_RUNS_ROOT) {
  return queueRun(id, async () => {
    const current = await readNodeRun(id, root);
    const patch = typeof update === 'function' ? update(structuredClone(current)) : update;
    const next = { ...current, ...structuredClone(patch) };
    if (TERMINAL.has(current.status) && next.status !== current.status) {
      throw new NodeRunStoreError('Terminal node run cannot transition.', 'NODE_RUN_TERMINAL', 409);
    }
    await atomicWrite(runPath(id, root), next);
    return structuredClone(next);
  });
}

export async function transitionNodeRun(id, status, updates = {}, root = NODE_RUNS_ROOT) {
  return queueRun(id, async () => {
    const current = await readNodeRun(id, root);
    if (current.status === status) return structuredClone(current);
    if (TERMINAL.has(current.status) || !TRANSITIONS[current.status]?.has(status)) {
      throw new NodeRunStoreError(`Cannot transition ${current.status} to ${status}.`, 'NODE_RUN_TRANSITION_INVALID', 409);
    }
    const now = new Date().toISOString();
    const next = { ...current, ...structuredClone(updates), status };
    if (status === 'claimed') {
      next.claimedAt = updates.claimedAt || now;
      next.workerId = updates.workerId || next.workerId;
      next.leaseExpiresAt = updates.leaseExpiresAt || next.leaseExpiresAt;
    }
    if (status === 'running') next.startedAt = updates.startedAt || current.startedAt || now;
    if (status === 'waiting') next.startedAt = updates.startedAt || current.startedAt || now;
    if (TERMINAL.has(status)) {
      next.completedAt = updates.completedAt || now;
      next.durationMs = next.startedAt ? Math.max(0, new Date(next.completedAt) - new Date(next.startedAt)) : null;
      next.leaseExpiresAt = null;
      next.workerId = updates.workerId === undefined ? next.workerId : updates.workerId;
    }
    next.events = [...(current.events || []), {
      type: `node_run.${status}`,
      at: now,
      status,
      attempt: next.attempt,
      workerId: next.workerId,
      leaseExpiresAt: next.leaseExpiresAt,
      error: next.error
    }];
    await atomicWrite(runPath(id, root), next);
    return structuredClone(next);
  });
}

export async function claimNodeRun(id, { workerId, leaseMs = 30_000 } = {}, root = NODE_RUNS_ROOT) {
  if (!workerId) throw new NodeRunStoreError('workerId is required to claim a node run.', 'NODE_RUN_WORKER_REQUIRED', 422);
  const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
  return transitionNodeRun(id, 'claimed', { workerId, leaseExpiresAt }, root);
}

export async function renewNodeRunLease(id, { workerId, leaseMs = 30_000 } = {}, root = NODE_RUNS_ROOT) {
  return updateNodeRun(id, (run) => {
    if (run.status !== 'claimed' && run.status !== 'running') throw new NodeRunStoreError('Only claimed or running node runs can renew leases.', 'NODE_RUN_LEASE_RENEW_INVALID', 409);
    if (run.workerId !== workerId) throw new NodeRunStoreError('Node run is claimed by another worker.', 'NODE_RUN_WORKER_MISMATCH', 409);
    const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    return {
      leaseExpiresAt,
      events: [...(run.events || []), { type: 'node_run.lease_renewed', at: new Date().toISOString(), status: run.status, workerId, leaseExpiresAt }]
    };
  }, root);
}

export async function reconcileNodeRuns(root = NODE_RUNS_ROOT) {
  const runs = await listNodeRuns({}, root);
  return Promise.all(runs.filter((run) => ['claimed', 'running'].includes(run.status)).map((run) => transitionNodeRun(run.id, 'interrupted', {
    error: { code: 'NODE_RUN_INTERRUPTED', message: 'The service restarted before the node run completed.' }
  }, root)));
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, filePath);
}

function queueRun(id, operation) {
  const previous = queues.get(id) || Promise.resolve();
  const queued = previous.catch(() => {}).then(operation);
  queues.set(id, queued);
  return queued.finally(() => { if (queues.get(id) === queued) queues.delete(id); });
}

function assertRunId(id) {
  if (!/^nrun_[0-9a-f-]{36}$/.test(id || '')) throw new NodeRunStoreError('Invalid node run id.', 'NODE_RUN_ID_INVALID', 422);
}

function runPath(id, root) { return path.join(root, `${id}.json`); }
