import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STATE_ROOT } from './stateStore.js';
import { validateSkillDefinition } from './skillSchema.js';

export const SKILLS_ROOT = process.env.AGENT_HUB_SKILLS_ROOT || process.env.AGENT_BOARD_SKILLS_ROOT || path.join(STATE_ROOT, 'skills');
const queues = new Map();

export class SkillStoreError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}

export async function createSkill(input, root = SKILLS_ROOT) {
  const skill = validateSkillDefinition({ ...input, version: 1, status: 'draft', publishedAt: null });
  return queue(skill.id, root, async () => {
    if (await exists(dir(skill.id, root))) throw new SkillStoreError(`Skill ${skill.id} already exists.`, 'SKILL_EXISTS', 409);
    await atomicWrite(draftPath(skill.id, root), skill);
    return structuredClone(skill);
  });
}

export async function listSkills({ includeArchived = false } = {}, root = SKILLS_ROOT) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readSkill(entry.name, undefined, root).catch(() => null))))
    .filter(Boolean).filter((skill) => includeArchived || skill.status !== 'archived')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readSkill(id, version, root = SKILLS_ROOT) {
  assertId(id);
  if (version !== undefined) return read(versionPath(id, version, root), id);
  const archived = await exists(archivePath(id, root));
  const draft = await read(draftPath(id, root), id).catch((error) => error.code === 'SKILL_NOT_FOUND' ? null : Promise.reject(error));
  if (draft) return archived ? { ...draft, status: 'archived' } : draft;
  const versions = await versionNumbers(id, root);
  if (!versions.length) throw new SkillStoreError(`Skill ${id} was not found.`, 'SKILL_NOT_FOUND', 404);
  const latest = await read(versionPath(id, versions.at(-1), root), id);
  return archived ? { ...latest, status: 'archived' } : latest;
}

export async function listSkillVersions(id, root = SKILLS_ROOT) {
  const versions = await versionNumbers(id, root);
  const published = await Promise.all(versions.map((version) => read(versionPath(id, version, root), id)));
  const draft = await read(draftPath(id, root), id).catch(() => null);
  return draft ? [...published, draft] : published;
}

export async function updateSkillDraft(id, updates, root = SKILLS_ROOT) {
  return queue(id, root, async () => {
    const current = await read(draftPath(id, root), id);
    const skill = validateSkillDefinition({ ...current, ...updates, id: current.id, version: current.version, status: 'draft', createdAt: current.createdAt, publishedAt: null, updatedAt: new Date().toISOString() });
    await atomicWrite(draftPath(id, root), skill);
    return structuredClone(skill);
  });
}

export async function publishSkill(id, root = SKILLS_ROOT) {
  return queue(id, root, async () => {
    const draft = validateSkillDefinition(await read(draftPath(id, root), id));
    const target = versionPath(id, draft.version, root);
    if (await exists(target)) throw new SkillStoreError(`Version ${draft.version} already exists.`, 'SKILL_VERSION_EXISTS', 409);
    const published = { ...draft, status: 'published', publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await atomicWrite(target, published); await unlink(draftPath(id, root)); await unlink(archivePath(id, root)).catch(() => {});
    return structuredClone(published);
  });
}

export async function createSkillDraftVersion(id, root = SKILLS_ROOT) {
  return queue(id, root, async () => {
    if (await exists(draftPath(id, root))) throw new SkillStoreError('A draft already exists.', 'SKILL_DRAFT_EXISTS', 409);
    const versions = await versionNumbers(id, root);
    if (!versions.length) throw new SkillStoreError(`Skill ${id} was not found.`, 'SKILL_NOT_FOUND', 404);
    const latest = await read(versionPath(id, versions.at(-1), root), id);
    const draft = { ...latest, version: latest.version + 1, status: 'draft', publishedAt: null, updatedAt: new Date().toISOString() };
    await atomicWrite(draftPath(id, root), draft); await unlink(archivePath(id, root)).catch(() => {});
    return structuredClone(draft);
  });
}

export async function archiveSkill(id, root = SKILLS_ROOT) {
  return queue(id, root, async () => {
    const current = await readSkill(id, undefined, root);
    const archivedAt = new Date().toISOString();
    await atomicWrite(archivePath(id, root), { archivedAt });
    return { ...current, status: 'archived', updatedAt: archivedAt };
  });
}

async function versionNumbers(id, root) { return (await readdir(dir(id, root)).catch(() => [])).map((name) => name.match(/^v(\d+)\.json$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b); }
async function read(file, id) { try { return structuredClone(JSON.parse(await readFile(file, 'utf8'))); } catch (error) { if (error.code === 'ENOENT') throw new SkillStoreError(`Skill ${id} was not found.`, 'SKILL_NOT_FOUND', 404); throw error; } }
async function atomicWrite(file, value) { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.${Date.now()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, file); }
async function exists(file) { return import('node:fs/promises').then(({ stat }) => stat(file).then(() => true).catch(() => false)); }
function queue(id, root, operation) { assertId(id); const key = dir(id, root); const previous = queues.get(key) || Promise.resolve(); const next = previous.catch(() => {}).then(operation); queues.set(key, next); return next.finally(() => { if (queues.get(key) === next) queues.delete(key); }); }
function assertId(id) { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) throw new SkillStoreError('Invalid skill id.', 'SKILL_ID_INVALID', 422); }
function dir(id, root) { return path.join(root, id); }
function draftPath(id, root) { return path.join(dir(id, root), 'draft.json'); }
function versionPath(id, version, root) { return path.join(dir(id, root), `v${Number(version)}.json`); }
function archivePath(id, root) { return path.join(dir(id, root), 'archived.json'); }
