import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_ROOT } from './stateStore.js';

export const WORKFLOW_RUNS_ROOT = process.env.AGENT_BOARD_WORKFLOW_RUNS_ROOT || path.join(STATE_ROOT, 'workflow-runs');
const queues = new Map();
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

export class WorkflowRunStoreError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}

export async function createWorkflowRun({ workflow, input, idempotencyKey = '', parentRunId = '' }, root = WORKFLOW_RUNS_ROOT) {
  const now = new Date().toISOString();
  const run = {
    id: `wrun_${randomUUID()}`,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    idempotencyKey,
    parentRunId,
    workflowSnapshot: structuredClone(workflow),
    status: 'queued',
    input: structuredClone(input),
    output: null,
    error: null,
    currentNodeId: null,
    nodes: Object.fromEntries(workflow.nodes.map((node) => [node.id, { id: node.id, type: node.type, status: 'pending', input: null, output: null, error: null, agentRunId: null, startedAt: null, completedAt: null, durationMs: null }])),
    createdAt: now,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    events: [{ type: 'run.created', at: now }]
  };
  await atomicWrite(runPath(run.id, root), run);
  return run;
}

export async function readWorkflowRun(id, root = WORKFLOW_RUNS_ROOT) {
  assertId(id);
  try { return JSON.parse(await readFile(runPath(id, root), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') throw new WorkflowRunStoreError(`Workflow run ${id} was not found.`, 'WORKFLOW_RUN_NOT_FOUND', 404); throw error; }
}

export async function listWorkflowRuns({ workflowId } = {}, root = WORKFLOW_RUNS_ROOT) {
  await mkdir(root, { recursive: true });
  const names = (await readdir(root)).filter((name) => name.endsWith('.json'));
  const runs = await Promise.all(names.map((name) => readWorkflowRun(name.slice(0, -5), root)));
  return runs.filter((run) => !workflowId || run.workflowId === workflowId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateWorkflowRun(id, update, root = WORKFLOW_RUNS_ROOT) {
  return queue(id, async () => {
    const current = await readWorkflowRun(id, root);
    const patch = typeof update === 'function' ? update(structuredClone(current)) : update;
    const next = { ...current, ...structuredClone(patch) };
    if (TERMINAL.has(current.status) && next.status !== current.status) throw new WorkflowRunStoreError('Terminal workflow run cannot transition.', 'WORKFLOW_RUN_TERMINAL', 409);
    await atomicWrite(runPath(id, root), next);
    return next;
  });
}

export async function reconcileWorkflowRuns(root = WORKFLOW_RUNS_ROOT) {
  const runs = await listWorkflowRuns({}, root);
  return Promise.all(runs.filter((run) => ['queued', 'running'].includes(run.status)).map((run) => finishWorkflowRun(run.id, 'failed', {
    error: { code: 'WORKFLOW_RUN_INTERRUPTED', message: 'The service restarted before the workflow completed.' }
  }, root)));
}

export async function finishWorkflowRun(id, status, updates = {}, root = WORKFLOW_RUNS_ROOT) {
  const now = new Date().toISOString();
  return updateWorkflowRun(id, (current) => ({ ...updates, status, currentNodeId: null, completedAt: now, durationMs: current.startedAt ? Math.max(0, new Date(now) - new Date(current.startedAt)) : null, events: [...(current.events || []), { type: `run.${status}`, at: now, error: updates.error || null }] }), root);
}

export async function pauseWorkflowRun(id, nodeId, root = WORKFLOW_RUNS_ROOT) {
  return updateWorkflowRun(id, (current) => ({ status: 'waiting_approval', currentNodeId: nodeId, events: [...(current.events || []), { type: 'run.waiting_approval', nodeId, at: new Date().toISOString() }] }), root);
}

async function atomicWrite(file, value) { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.${Date.now()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, file); }
function queue(id, operation) { const previous = queues.get(id) || Promise.resolve(); const next = previous.catch(() => {}).then(operation); queues.set(id, next); return next.finally(() => { if (queues.get(id) === next) queues.delete(id); }); }
function assertId(id) { if (!/^wrun_[0-9a-f-]{36}$/.test(id || '')) throw new WorkflowRunStoreError('Invalid workflow run id.', 'WORKFLOW_RUN_ID_INVALID', 422); }
function runPath(id, root) { return path.join(root, `${id}.json`); }
