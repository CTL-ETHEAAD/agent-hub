import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_ROOT } from '../stateStore.js';
import { redact } from '../audit/auditEvent.js';

export const TRACES_ROOT = process.env.AGENT_BOARD_TRACES_ROOT || path.join(STATE_ROOT, 'traces');
const queues = new Map();

export class TraceStoreError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'TraceStoreError';
    this.code = code;
    this.status = status;
  }
}

export async function appendTrace(runId, event, root = TRACES_ROOT) {
  assertRunId(runId);
  return queue(runId, root, async () => {
    const current = await listTraces(runId, root).catch((error) => error.code === 'TRACE_RUN_NOT_FOUND' ? [] : Promise.reject(error));
    const trace = normalizeTrace(runId, event);
    const next = [...current, trace];
    await atomicWrite(tracePath(runId, root), next);
    return trace;
  });
}

export async function listTraces(runId, root = TRACES_ROOT) {
  assertRunId(runId);
  try { return JSON.parse(await readFile(tracePath(runId, root), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function listTraceRunIds(root = TRACES_ROOT) {
  await mkdir(root, { recursive: true });
  return (await readdir(root)).map((name) => name.match(/^((?:wrun|run)_[0-9a-f-]{36})\.json$/)?.[1]).filter(Boolean);
}

function normalizeTrace(runId, event = {}) {
  return {
    traceId: event.traceId || `trace_${randomUUID()}`,
    runId,
    nodeId: typeof event.nodeId === 'string' ? event.nodeId : '',
    type: typeof event.type === 'string' && event.type ? event.type : 'trace.recorded',
    agentId: typeof event.agentId === 'string' ? event.agentId : '',
    toolId: typeof event.toolId === 'string' ? event.toolId : '',
    policyDecisions: Array.isArray(event.policyDecisions) ? event.policyDecisions : [],
    latencyMs: Number.isFinite(event.latencyMs) ? event.latencyMs : null,
    riskFlags: Array.isArray(event.riskFlags) ? event.riskFlags : [],
    payload: redact(event.payload || {}),
    at: event.at || new Date().toISOString()
  };
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, filePath);
}

function queue(runId, root, operation) {
  const key = tracePath(runId, root);
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(key, next);
  return next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
}

function assertRunId(id) {
  if (!/^(?:wrun|run)_[0-9a-f-]{36}$/.test(id || '')) throw new TraceStoreError('Invalid workflow or agent run id.', 'TRACE_RUN_ID_INVALID', 422);
}

function tracePath(runId, root) {
  return path.join(root, `${runId}.json`);
}
