import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STATE_ROOT } from './stateStore.js';
import { validateTool } from './toolSchema.js';
import { analyzeSchemaCompatibility } from './schemaCompatibility.js';

export const TOOLS_ROOT = process.env.AGENT_HUB_TOOLS_ROOT || path.join(STATE_ROOT, 'tools');
const queues = new Map();

export class ToolStoreError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}

export async function createTool(input, root = TOOLS_ROOT) {
  const tool = validateTool({ ...input, version: 1, status: 'draft', publishedAt: null });
  return queue(tool.id, async () => {
    if (await exists(dir(tool.id, root))) throw new ToolStoreError(`Tool ${tool.id} already exists.`, 'TOOL_EXISTS', 409);
    await atomicWrite(draftPath(tool.id, root), tool);
    return tool;
  });
}

export async function listTools({ includeArchived = false } = {}, root = TOOLS_ROOT) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const tools = (await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readTool(entry.name, undefined, root).catch(() => null)))).filter(Boolean);
  return tools.filter((tool) => includeArchived || tool.status !== 'archived').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readTool(id, version, root = TOOLS_ROOT) {
  assertId(id);
  if (version !== undefined) return read(versionPath(id, version, root), id);
  const archived = await exists(archivePath(id, root));
  const draft = await read(draftPath(id, root), id).catch((error) => error.code === 'TOOL_NOT_FOUND' ? null : Promise.reject(error));
  if (draft) return archived ? { ...draft, status: 'archived' } : draft;
  const versions = await versionNumbers(id, root);
  if (!versions.length) throw new ToolStoreError(`Tool ${id} was not found.`, 'TOOL_NOT_FOUND', 404);
  const tool = await read(versionPath(id, versions.at(-1), root), id);
  return archived ? { ...tool, status: 'archived' } : tool;
}

export async function updateToolDraft(id, updates, root = TOOLS_ROOT) {
  return queue(id, async () => {
    const current = await read(draftPath(id, root), id);
    const tool = validateTool({ ...current, ...updates, id, version: current.version, status: 'draft', publishedAt: null, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
    await atomicWrite(draftPath(id, root), tool);
    return tool;
  });
}

export async function publishTool(id, root = TOOLS_ROOT) {
  return queue(id, async () => {
    const current = validateTool(await read(draftPath(id, root), id));
    if (await exists(versionPath(id, current.version, root))) throw new ToolStoreError('Tool version already exists.', 'TOOL_VERSION_EXISTS', 409);
    const versions = await versionNumbers(id, root);
    const previous = versions.length ? await read(versionPath(id, versions.at(-1), root), id) : null;
    const now = new Date().toISOString();
    const compatibility = analyzeSchemaCompatibility(previous, current, now);
    const published = { ...current, compatibility, status: 'published', publishedAt: now, updatedAt: now };
    await atomicWrite(versionPath(id, current.version, root), published);
    await unlink(draftPath(id, root));
    await unlink(archivePath(id, root)).catch(() => {});
    return published;
  });
}

export async function createToolDraftVersion(id, root = TOOLS_ROOT) {
  return queue(id, async () => {
    if (await exists(draftPath(id, root))) throw new ToolStoreError('A draft already exists.', 'TOOL_DRAFT_EXISTS', 409);
    const versions = await versionNumbers(id, root);
    if (!versions.length) throw new ToolStoreError(`Tool ${id} was not found.`, 'TOOL_NOT_FOUND', 404);
    const latest = await read(versionPath(id, versions.at(-1), root), id);
    const { compatibility: _compatibility, ...definition } = latest;
    const draft = { ...definition, version: latest.version + 1, status: 'draft', publishedAt: null, updatedAt: new Date().toISOString() };
    await atomicWrite(draftPath(id, root), draft);
    await unlink(archivePath(id, root)).catch(() => {});
    return draft;
  });
}

export async function cloneTool(id, { id: newId, name } = {}, root = TOOLS_ROOT) {
  const source = await readTool(id, undefined, root);
  const { compatibility: _compatibility, ...definition } = source;
  return createTool({ ...definition, id: newId, name: name || `${source.name} Copy`, createdAt: undefined, updatedAt: undefined }, root);
}

export async function archiveTool(id, root = TOOLS_ROOT) {
  return queue(id, async () => {
    const current = await readTool(id, undefined, root);
    await atomicWrite(archivePath(id, root), { archivedAt: new Date().toISOString() });
    return { ...current, status: 'archived' };
  });
}

async function versionNumbers(id, root) { return (await readdir(dir(id, root)).catch(() => [])).map((name) => name.match(/^v(\d+)\.json$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b); }
async function read(file, id) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') throw new ToolStoreError(`Tool ${id} was not found.`, 'TOOL_NOT_FOUND', 404); throw error; } }
async function atomicWrite(file, value) { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.${Date.now()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, file); }
async function exists(file) { return import('node:fs/promises').then(({ stat }) => stat(file).then(() => true).catch(() => false)); }
function queue(id, operation) { assertId(id); const previous = queues.get(id) || Promise.resolve(); const next = previous.catch(() => {}).then(operation); queues.set(id, next); return next.finally(() => { if (queues.get(id) === next) queues.delete(id); }); }
function assertId(id) { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) throw new ToolStoreError('Invalid tool id.', 'TOOL_ID_INVALID', 422); }
function dir(id, root) { return path.join(root, id); }
function draftPath(id, root) { return path.join(dir(id, root), 'draft.json'); }
function versionPath(id, version, root) { return path.join(dir(id, root), `v${Number(version)}.json`); }
function archivePath(id, root) { return path.join(dir(id, root), 'archived.json'); }
