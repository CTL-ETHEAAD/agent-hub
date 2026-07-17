import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { STATE_ROOT } from './stateStore.js';

export const WORKERS_ROOT = process.env.AGENT_HUB_WORKERS_ROOT || path.join(STATE_ROOT, 'workers');

const queues = new Map();

export class WorkerStoreError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'WorkerStoreError';
    this.code = code;
    this.status = status;
  }
}

export async function registerWorker({ id, role = 'worker', capabilityTags = [], concurrencySlots = 1, leaseMs = 30_000, pid = process.pid, hostname = os.hostname() } = {}, root = WORKERS_ROOT) {
  assertWorkerId(id);
  const now = new Date().toISOString();
  const worker = {
    id,
    pid,
    hostname,
    role,
    capabilityTags: [...new Set(capabilityTags)].sort(),
    concurrencySlots,
    status: 'online',
    registeredAt: now,
    heartbeatAt: now,
    leaseMs,
    activeNodeRunIds: []
  };
  await atomicWrite(workerPath(id, root), worker);
  return structuredClone(worker);
}

export async function readWorker(id, root = WORKERS_ROOT) {
  assertWorkerId(id);
  try {
    return structuredClone(JSON.parse(await readFile(workerPath(id, root), 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') throw new WorkerStoreError(`Worker ${id} was not found.`, 'WORKER_NOT_FOUND', 404);
    throw error;
  }
}

export async function listWorkers({ status, role } = {}, root = WORKERS_ROOT) {
  await mkdir(root, { recursive: true });
  const names = (await readdir(root)).filter((name) => name.endsWith('.json'));
  const workers = await Promise.all(names.map((name) => readWorker(name.slice(0, -5), root)));
  return workers
    .filter((worker) => !status || worker.status === status)
    .filter((worker) => !role || worker.role === role)
    .sort((a, b) => b.heartbeatAt.localeCompare(a.heartbeatAt));
}

export async function heartbeatWorker(id, updates = {}, root = WORKERS_ROOT) {
  return updateWorker(id, (worker) => ({
    ...updates,
    status: 'online',
    heartbeatAt: new Date().toISOString()
  }), root);
}

export async function assignNodeRunToWorker(id, nodeRunId, root = WORKERS_ROOT) {
  return updateWorker(id, (worker) => ({
    activeNodeRunIds: [...new Set([...(worker.activeNodeRunIds || []), nodeRunId])]
  }), root);
}

export async function releaseNodeRunFromWorker(id, nodeRunId, root = WORKERS_ROOT) {
  return updateWorker(id, (worker) => ({
    activeNodeRunIds: (worker.activeNodeRunIds || []).filter((value) => value !== nodeRunId)
  }), root);
}

export async function markStaleWorkers({ now = new Date(), staleAfterMs = 60_000 } = {}, root = WORKERS_ROOT) {
  const workers = await listWorkers({}, root);
  return Promise.all(workers
    .filter((worker) => worker.status === 'online')
    .filter((worker) => now - new Date(worker.heartbeatAt) >= staleAfterMs)
    .map((worker) => updateWorker(worker.id, { status: 'stale' }, root)));
}

export async function updateWorker(id, update, root = WORKERS_ROOT) {
  return queueWorker(id, async () => {
    const current = await readWorker(id, root);
    const patch = typeof update === 'function' ? update(structuredClone(current)) : update;
    const next = { ...current, ...structuredClone(patch) };
    await atomicWrite(workerPath(id, root), next);
    return structuredClone(next);
  });
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, filePath);
}

function queueWorker(id, operation) {
  const previous = queues.get(id) || Promise.resolve();
  const queued = previous.catch(() => {}).then(operation);
  queues.set(id, queued);
  return queued.finally(() => { if (queues.get(id) === queued) queues.delete(id); });
}

function assertWorkerId(id) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(id || '')) throw new WorkerStoreError('Invalid worker id.', 'WORKER_ID_INVALID', 422);
}

function workerPath(id, root) { return path.join(root, `${id}.json`); }
