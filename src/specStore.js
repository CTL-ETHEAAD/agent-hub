import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STATE_ROOT } from './stateStore.js';
import { validateSpec } from './specSchema.js';

export const SPECS_ROOT = process.env.AGENT_HUB_SPECS_ROOT || path.join(STATE_ROOT, 'specs');
const writeQueues = new Map();

export class SpecStoreError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'SpecStoreError';
    this.code = code;
    this.status = status;
  }
}

export async function createSpec(input, root = SPECS_ROOT) {
  const spec = validateSpec({ ...input, version: 1, status: 'draft', publishedAt: null });
  return queueSpec(spec.id, root, async () => {
    if (await specExists(spec.id, root)) throw new SpecStoreError(`Spec ${spec.id} already exists.`, 'SPEC_EXISTS', 409);
    await atomicWrite(draftPath(spec.id, root), spec);
    return structuredClone(spec);
  });
}

export async function listSpecs({ includeArchived = false } = {}, root = SPECS_ROOT) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const specs = (await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readSpec(entry.name, undefined, root).catch(() => null))))
    .filter(Boolean)
    .filter((spec) => includeArchived || spec.status !== 'archived')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return specs;
}

export async function readSpec(id, version, root = SPECS_ROOT) {
  assertId(id);
  if (version !== undefined) return readJson(versionPath(id, version, root), id);
  const archived = await fileExists(archivePath(id, root));
  const draft = await readJson(draftPath(id, root), id).catch((error) => {
    if (error.code !== 'SPEC_NOT_FOUND') throw error;
    return null;
  });
  if (draft) return archived ? { ...draft, status: 'archived' } : draft;
  const versions = await listVersions(id, root);
  if (!versions.length) throw new SpecStoreError(`Spec ${id} was not found.`, 'SPEC_NOT_FOUND', 404);
  const latest = await readJson(versionPath(id, versions.at(-1), root), id);
  return archived ? { ...latest, status: 'archived' } : latest;
}

export async function listSpecVersions(id, root = SPECS_ROOT) {
  const versions = await listVersions(id, root);
  const published = await Promise.all(versions.map((version) => readJson(versionPath(id, version, root), id)));
  const draft = await readJson(draftPath(id, root), id).catch(() => null);
  return draft ? [...published, draft] : published;
}

export async function updateSpecDraft(id, updates, root = SPECS_ROOT) {
  return queueSpec(id, root, async () => {
    const current = await readJson(draftPath(id, root), id);
    const spec = validateSpec({
      ...current,
      ...updates,
      id: current.id,
      version: current.version,
      status: 'draft',
      createdAt: current.createdAt,
      publishedAt: null,
      updatedAt: new Date().toISOString()
    });
    await atomicWrite(draftPath(id, root), spec);
    return structuredClone(spec);
  });
}

export async function publishSpec(id, root = SPECS_ROOT) {
  return queueSpec(id, root, async () => {
    const draft = validateSpec(await readJson(draftPath(id, root), id));
    const target = versionPath(id, draft.version, root);
    if (await fileExists(target)) throw new SpecStoreError(`Version ${draft.version} already exists.`, 'SPEC_VERSION_EXISTS', 409);
    const now = new Date().toISOString();
    const published = { ...draft, status: 'published', publishedAt: now, updatedAt: now };
    await atomicWrite(target, published);
    await unlink(draftPath(id, root));
    await unlink(archivePath(id, root)).catch(() => {});
    return structuredClone(published);
  });
}

export async function createSpecDraftVersion(id, root = SPECS_ROOT) {
  return queueSpec(id, root, async () => {
    if (await fileExists(draftPath(id, root))) throw new SpecStoreError('A draft already exists.', 'SPEC_DRAFT_EXISTS', 409);
    const versions = await listVersions(id, root);
    if (!versions.length) throw new SpecStoreError(`Spec ${id} was not found.`, 'SPEC_NOT_FOUND', 404);
    const latest = await readJson(versionPath(id, versions.at(-1), root), id);
    const draft = { ...latest, version: latest.version + 1, status: 'draft', publishedAt: null, updatedAt: new Date().toISOString() };
    await atomicWrite(draftPath(id, root), draft);
    await unlink(archivePath(id, root)).catch(() => {});
    return structuredClone(draft);
  });
}

export async function archiveSpec(id, root = SPECS_ROOT) {
  return queueSpec(id, root, async () => {
    const current = await readSpec(id, undefined, root);
    const archived = { ...current, status: 'archived', updatedAt: new Date().toISOString() };
    await atomicWrite(archivePath(id, root), { archivedAt: archived.updatedAt });
    return structuredClone(archived);
  });
}

async function listVersions(id, root) {
  const dir = specDir(id, root);
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
    if (error.code === 'ENOENT') throw new SpecStoreError(`Spec ${id} was not found.`, 'SPEC_NOT_FOUND', 404);
    throw error;
  }
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, filePath);
}

function queueSpec(id, root, operation) {
  assertId(id);
  const key = specDir(id, root);
  const previous = writeQueues.get(key) || Promise.resolve();
  const queued = previous.catch(() => {}).then(operation);
  writeQueues.set(key, queued);
  return queued.finally(() => {
    if (writeQueues.get(key) === queued) writeQueues.delete(key);
  });
}

async function specExists(id, root) {
  return fileExists(specDir(id, root));
}

async function fileExists(filePath) {
  return import('node:fs/promises').then(({ stat }) => stat(filePath).then(() => true).catch(() => false));
}

function assertId(id) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) throw new SpecStoreError('Invalid spec id.', 'SPEC_ID_INVALID', 422);
}

function specDir(id, root) { return path.join(root, id); }
function draftPath(id, root) { return path.join(specDir(id, root), 'draft.json'); }
function versionPath(id, version, root) { return path.join(specDir(id, root), `v${Number(version)}.json`); }
function archivePath(id, root) { return path.join(specDir(id, root), 'archived.json'); }
