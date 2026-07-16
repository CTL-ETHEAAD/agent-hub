import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STATE_ROOT } from './stateStore.js';
import { readAgent } from './agentStore.js';
import { readTool } from './toolStore.js';
import { WorkflowValidationError, validateWorkflow } from './workflowSchema.js';
import { analyzeWorkflowAssets } from './workflowAssetContract.js';

export const WORKFLOWS_ROOT = process.env.AGENT_HUB_WORKFLOWS_ROOT || path.join(STATE_ROOT, 'workflows');
const queues = new Map();

export class WorkflowStoreError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}

export async function createWorkflow(input, root = WORKFLOWS_ROOT) {
  const workflow = validateWorkflow({ ...input, version: 1, status: 'draft', publishedAt: null });
  return queue(workflow.id, async () => {
    if (await exists(dir(workflow.id, root))) throw new WorkflowStoreError(`Workflow ${workflow.id} already exists.`, 'WORKFLOW_EXISTS', 409);
    await atomicWrite(draftPath(workflow.id, root), workflow);
    return workflow;
  });
}

export async function listWorkflows({ includeArchived = false } = {}, root = WORKFLOWS_ROOT) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const values = (await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readWorkflow(entry.name, undefined, root).catch(() => null)))).filter(Boolean);
  return values.filter((item) => includeArchived || item.status !== 'archived').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readWorkflow(id, version, root = WORKFLOWS_ROOT) {
  assertId(id);
  if (version !== undefined) return read(versionPath(id, version, root), id);
  const archived = await exists(archivePath(id, root));
  const draft = await read(draftPath(id, root), id).catch((error) => error.code === 'WORKFLOW_NOT_FOUND' ? null : Promise.reject(error));
  if (draft) return archived ? { ...draft, status: 'archived' } : draft;
  const versions = await versionNumbers(id, root);
  if (!versions.length) throw new WorkflowStoreError(`Workflow ${id} was not found.`, 'WORKFLOW_NOT_FOUND', 404);
  const value = await read(versionPath(id, versions.at(-1), root), id);
  return archived ? { ...value, status: 'archived' } : value;
}

export async function updateWorkflowDraft(id, updates, root = WORKFLOWS_ROOT) {
  return queue(id, async () => {
    const current = await read(draftPath(id, root), id);
    const next = validateWorkflow({ ...current, ...updates, id, version: current.version, status: 'draft', publishedAt: null, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
    await atomicWrite(draftPath(id, root), next);
    return next;
  });
}

export async function publishWorkflow(id, root = WORKFLOWS_ROOT, assetResolver) {
  return queue(id, async () => {
    const current = validateWorkflow(await read(draftPath(id, root), id));
    const resolver = assetResolver || {
      resolveAgent: (assetId, version) => readAgent(assetId, version),
      resolveTool: (assetId, version) => readTool(assetId, version),
      resolveWorkflow: (assetId, version) => readWorkflow(assetId, version, root)
    };
    const assetAnalysis = await analyzeWorkflowAssets(current, resolver);
    if (assetAnalysis.errors.length) throw new WorkflowValidationError('Workflow assets are incompatible.', assetAnalysis.errors, 'WORKFLOW_ASSET_INVALID');
    const resolvedNodes = current.nodes.map((node) => {
      const resolved = assetAnalysis.resolvedSchemas[node.id];
      if (!resolved) return node;
      if (node.type === 'agent') return { ...node, agentVersion: node.agentVersion || resolved.version };
      if (node.type === 'tool') return { ...node, toolVersion: node.toolVersion || resolved.version };
      if (node.type === 'subworkflow') return { ...node, workflowVersion: node.workflowVersion || resolved.version };
      return node;
    });
    if (await exists(versionPath(id, current.version, root))) throw new WorkflowStoreError('Workflow version already exists.', 'WORKFLOW_VERSION_EXISTS', 409);
    const published = { ...current, nodes: resolvedNodes, status: 'published', publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await atomicWrite(versionPath(id, current.version, root), published);
    await unlink(draftPath(id, root));
    await unlink(archivePath(id, root)).catch(() => {});
    return published;
  });
}

export async function createWorkflowDraftVersion(id, root = WORKFLOWS_ROOT) {
  return queue(id, async () => {
    if (await exists(draftPath(id, root))) throw new WorkflowStoreError('A draft already exists.', 'WORKFLOW_DRAFT_EXISTS', 409);
    const versions = await versionNumbers(id, root);
    if (!versions.length) throw new WorkflowStoreError(`Workflow ${id} was not found.`, 'WORKFLOW_NOT_FOUND', 404);
    const latest = await read(versionPath(id, versions.at(-1), root), id);
    const draft = { ...latest, version: latest.version + 1, status: 'draft', publishedAt: null, updatedAt: new Date().toISOString() };
    await atomicWrite(draftPath(id, root), draft);
    await unlink(archivePath(id, root)).catch(() => {});
    return draft;
  });
}

export async function archiveWorkflow(id, root = WORKFLOWS_ROOT) {
  return queue(id, async () => {
    const current = await readWorkflow(id, undefined, root);
    await atomicWrite(archivePath(id, root), { archivedAt: new Date().toISOString() });
    return { ...current, status: 'archived' };
  });
}

export async function cloneWorkflow(id, { id: newId, name } = {}, root = WORKFLOWS_ROOT) {
  const source = await readWorkflow(id, undefined, root);
  return createWorkflow({ ...source, id: newId, name: name || `${source.name} Copy`, createdAt: undefined, updatedAt: undefined }, root);
}

async function versionNumbers(id, root) {
  return (await readdir(dir(id, root)).catch(() => [])).map((name) => name.match(/^v(\d+)\.json$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
}
async function read(file, id) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') throw new WorkflowStoreError(`Workflow ${id} was not found.`, 'WORKFLOW_NOT_FOUND', 404); throw error; } }
async function atomicWrite(file, value) { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.${Date.now()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, file); }
async function exists(file) { return import('node:fs/promises').then(({ stat }) => stat(file).then(() => true).catch(() => false)); }
function queue(id, operation) { assertId(id); const previous = queues.get(id) || Promise.resolve(); const next = previous.catch(() => {}).then(operation); queues.set(id, next); return next.finally(() => { if (queues.get(id) === next) queues.delete(id); }); }
function assertId(id) { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) throw new WorkflowStoreError('Invalid workflow id.', 'WORKFLOW_ID_INVALID', 422); }
function dir(id, root) { return path.join(root, id); }
function draftPath(id, root) { return path.join(dir(id, root), 'draft.json'); }
function versionPath(id, version, root) { return path.join(dir(id, root), `v${Number(version)}.json`); }
function archivePath(id, root) { return path.join(dir(id, root), 'archived.json'); }
