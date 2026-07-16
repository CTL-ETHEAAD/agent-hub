import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_ROOT } from './stateStore.js';

export const AGENT_RUNS_ROOT = process.env.AGENT_HUB_RUNS_ROOT || path.join(STATE_ROOT, 'agent-runs');
export const AGENT_RUN_LOGS_ROOT = process.env.AGENT_HUB_RUN_LOGS_ROOT || path.join(STATE_ROOT, 'logs', 'agent-runs');
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const TRANSITIONS = {
  queued: new Set(['running', 'failed', 'cancelled']),
  running: new Set(['succeeded', 'failed', 'cancelled'])
};
const queues = new Map();

export class AgentRunStoreError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'AgentRunStoreError';
    this.code = code;
    this.status = status;
  }
}

export async function createAgentRun({ agent, input }, root = AGENT_RUNS_ROOT, logsRoot = AGENT_RUN_LOGS_ROOT) {
  const now = new Date().toISOString();
  const run = {
    id: `run_${randomUUID()}`,
    agentId: agent.id,
    agentVersion: agent.version,
    agentSnapshot: structuredClone(agent),
    status: 'queued',
    input: structuredClone(input),
    output: null,
    error: null,
    runtime: agent.runtime.provider,
    model: agent.runtime.model,
    logPath: path.join(logsRoot, ''),
    pid: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    usage: { inputTokens: null, outputTokens: null, costUsd: null }
  };
  run.logPath = path.join(logsRoot, `${run.id}.log`);
  await atomicWrite(runPath(run.id, root), run);
  return structuredClone(run);
}

export async function readAgentRun(id, root = AGENT_RUNS_ROOT) {
  assertRunId(id);
  try {
    return structuredClone(JSON.parse(await readFile(runPath(id, root), 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') throw new AgentRunStoreError(`Run ${id} was not found.`, 'AGENT_RUN_NOT_FOUND', 404);
    throw error;
  }
}

export async function listAgentRuns({ agentId } = {}, root = AGENT_RUNS_ROOT) {
  await mkdir(root, { recursive: true });
  const names = (await readdir(root)).filter((name) => name.endsWith('.json'));
  const runs = await Promise.all(names.map((name) => readAgentRun(name.slice(0, -5), root)));
  return runs.filter((run) => !agentId || run.agentId === agentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function transitionAgentRun(id, status, updates = {}, root = AGENT_RUNS_ROOT) {
  return queueRun(id, async () => {
    const current = await readAgentRun(id, root);
    if (current.status === status) return current;
    if (TERMINAL.has(current.status) || !TRANSITIONS[current.status]?.has(status)) {
      throw new AgentRunStoreError(`Cannot transition ${current.status} to ${status}.`, 'AGENT_RUN_TRANSITION_INVALID', 409);
    }
    const now = new Date().toISOString();
    const next = { ...current, ...structuredClone(updates), status };
    if (status === 'running') next.startedAt = updates.startedAt || now;
    if (TERMINAL.has(status)) {
      next.completedAt = updates.completedAt || now;
      next.durationMs = next.startedAt ? Math.max(0, new Date(next.completedAt) - new Date(next.startedAt)) : null;
      next.pid = null;
    }
    await atomicWrite(runPath(id, root), next);
    return structuredClone(next);
  });
}

export async function reconcileAgentRuns(root = AGENT_RUNS_ROOT) {
  const runs = await listAgentRuns({}, root);
  return Promise.all(runs.filter((run) => run.status === 'queued' || run.status === 'running').map((run) => transitionAgentRun(run.id, 'failed', {
    error: { code: 'RUN_INTERRUPTED', message: 'The service restarted before the run completed.' }
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
  if (!/^run_[0-9a-f-]{36}$/.test(id || '')) throw new AgentRunStoreError('Invalid run id.', 'AGENT_RUN_ID_INVALID', 422);
}

function runPath(id, root) { return path.join(root, `${id}.json`); }
