import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STATE_ROOT } from './stateStore.js';
import { validateAgentDefinition } from './agentSchema.js';

export const AGENTS_ROOT = process.env.AGENT_BOARD_AGENTS_ROOT || path.join(STATE_ROOT, 'agents');
const writeQueues = new Map();

export class AgentStoreError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'AgentStoreError';
    this.code = code;
    this.status = status;
  }
}

export async function createAgent(input, root = AGENTS_ROOT) {
  const agent = validateAgentDefinition({ ...input, version: 1, status: 'draft', publishedAt: null });
  return queueAgent(agent.id, root, async () => {
    if (await agentExists(agent.id, root)) throw new AgentStoreError(`Agent ${agent.id} already exists.`, 'AGENT_EXISTS', 409);
    await atomicWrite(draftPath(agent.id, root), agent);
    return structuredClone(agent);
  });
}

export async function listAgents({ includeArchived = false } = {}, root = AGENTS_ROOT) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const agents = (await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readAgent(entry.name, undefined, root).catch(() => null))))
    .filter(Boolean)
    .filter((agent) => includeArchived || agent.status !== 'archived')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return agents;
}

export async function readAgent(id, version, root = AGENTS_ROOT) {
  assertId(id);
  if (version !== undefined) return readJson(versionPath(id, version, root), id);
  const archived = await fileExists(archivePath(id, root));
  const draft = await readJson(draftPath(id, root), id).catch((error) => {
    if (error.code !== 'AGENT_NOT_FOUND') throw error;
    return null;
  });
  if (draft) return archived ? { ...draft, status: 'archived' } : draft;
  const versions = await listVersions(id, root);
  if (!versions.length) throw new AgentStoreError(`Agent ${id} was not found.`, 'AGENT_NOT_FOUND', 404);
  const latest = await readJson(versionPath(id, versions.at(-1), root), id);
  return archived ? { ...latest, status: 'archived' } : latest;
}

export async function listAgentVersions(id, root = AGENTS_ROOT) {
  const versions = await listVersions(id, root);
  const published = await Promise.all(versions.map((version) => readJson(versionPath(id, version, root), id)));
  const draft = await readJson(draftPath(id, root), id).catch(() => null);
  return draft ? [...published, draft] : published;
}

export async function updateDraft(id, updates, root = AGENTS_ROOT) {
  return queueAgent(id, root, async () => {
    const current = await readJson(draftPath(id, root), id);
    const agent = validateAgentDefinition({
      ...current,
      ...updates,
      id: current.id,
      version: current.version,
      status: 'draft',
      createdAt: current.createdAt,
      publishedAt: null,
      updatedAt: new Date().toISOString()
    });
    await atomicWrite(draftPath(id, root), agent);
    return structuredClone(agent);
  });
}

export async function publishAgent(id, root = AGENTS_ROOT) {
  return queueAgent(id, root, async () => {
    const draft = validateAgentDefinition(await readJson(draftPath(id, root), id));
    const target = versionPath(id, draft.version, root);
    if (await fileExists(target)) throw new AgentStoreError(`Version ${draft.version} already exists.`, 'AGENT_VERSION_EXISTS', 409);
    const published = { ...draft, status: 'published', publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await atomicWrite(target, published);
    await unlink(draftPath(id, root));
    await unlink(archivePath(id, root)).catch(() => {});
    return structuredClone(published);
  });
}

export async function createDraftVersion(id, root = AGENTS_ROOT) {
  return queueAgent(id, root, async () => {
    if (await fileExists(draftPath(id, root))) throw new AgentStoreError('A draft already exists.', 'AGENT_DRAFT_EXISTS', 409);
    const versions = await listVersions(id, root);
    if (!versions.length) throw new AgentStoreError(`Agent ${id} was not found.`, 'AGENT_NOT_FOUND', 404);
    const latest = await readJson(versionPath(id, versions.at(-1), root), id);
    const draft = { ...latest, version: latest.version + 1, status: 'draft', publishedAt: null, updatedAt: new Date().toISOString() };
    await atomicWrite(draftPath(id, root), draft);
    await unlink(archivePath(id, root)).catch(() => {});
    return structuredClone(draft);
  });
}

export async function cloneAgent(id, { id: newId, name } = {}, root = AGENTS_ROOT) {
  const source = await readAgent(id, undefined, root);
  return createAgent({ ...source, id: newId, name: name || `${source.name} Copy`, createdAt: undefined, updatedAt: undefined }, root);
}

export async function archiveAgent(id, root = AGENTS_ROOT) {
  return queueAgent(id, root, async () => {
    const current = await readAgent(id, undefined, root);
    const archived = { ...current, status: 'archived', updatedAt: new Date().toISOString() };
    await atomicWrite(archivePath(id, root), { archivedAt: archived.updatedAt });
    return structuredClone(archived);
  });
}

async function listVersions(id, root) {
  const dir = agentDir(id, root);
  const names = await readdir(dir).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return names.map((name) => name.match(/^v(\d+)\.json$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
}

async function readJson(filePath, id) {
  try {
    return structuredClone(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') throw new AgentStoreError(`Agent ${id} was not found.`, 'AGENT_NOT_FOUND', 404);
    throw error;
  }
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, filePath);
}

function queueAgent(id, root, operation) {
  assertId(id);
  const key = agentDir(id, root);
  const previous = writeQueues.get(key) || Promise.resolve();
  const queued = previous.catch(() => {}).then(operation);
  writeQueues.set(key, queued);
  return queued.finally(() => {
    if (writeQueues.get(key) === queued) writeQueues.delete(key);
  });
}

async function agentExists(id, root) {
  return fileExists(agentDir(id, root));
}

async function fileExists(filePath) {
  return import('node:fs/promises').then(({ stat }) => stat(filePath).then(() => true).catch(() => false));
}

function assertId(id) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) throw new AgentStoreError('Invalid agent id.', 'AGENT_ID_INVALID', 422);
}

function agentDir(id, root) { return path.join(root, id); }
function draftPath(id, root) { return path.join(agentDir(id, root), 'draft.json'); }
function versionPath(id, version, root) { return path.join(agentDir(id, root), `v${Number(version)}.json`); }
function archivePath(id, root) { return path.join(agentDir(id, root), 'archived.json'); }
