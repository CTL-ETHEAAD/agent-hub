import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STATE_ROOT } from '../stateStore.js';
import { validatePolicy } from './policySchema.js';

export const POLICIES_ROOT = process.env.AGENT_BOARD_POLICIES_ROOT || path.join(STATE_ROOT, 'policies');
const queues = new Map();

export class PolicyStoreError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'PolicyStoreError';
    this.code = code;
    this.status = status;
  }
}

export async function createPolicy(input, root = POLICIES_ROOT) {
  const policy = validatePolicy({ ...input, version: 1, status: 'draft', publishedAt: null });
  return queue(policy.id, root, async () => {
    if (await exists(dir(policy.id, root))) throw new PolicyStoreError(`Policy ${policy.id} already exists.`, 'POLICY_EXISTS', 409);
    await atomicWrite(draftPath(policy.id, root), policy);
    return structuredClone(policy);
  });
}

export async function listPolicies({ includeArchived = false } = {}, root = POLICIES_ROOT) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const policies = (await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readPolicy(entry.name, undefined, root).catch(() => null))))
    .filter(Boolean)
    .filter((policy) => includeArchived || policy.status !== 'archived')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return policies;
}

export async function readPolicy(id, version, root = POLICIES_ROOT) {
  assertId(id);
  if (version !== undefined) return read(versionPath(id, version, root), id);
  const archived = await exists(archivePath(id, root));
  const draft = await read(draftPath(id, root), id).catch((error) => error.code === 'POLICY_NOT_FOUND' ? null : Promise.reject(error));
  if (draft) return archived ? { ...draft, status: 'archived' } : draft;
  const versions = await versionNumbers(id, root);
  if (!versions.length) throw new PolicyStoreError(`Policy ${id} was not found.`, 'POLICY_NOT_FOUND', 404);
  const policy = await read(versionPath(id, versions.at(-1), root), id);
  return archived ? { ...policy, status: 'archived' } : policy;
}

export async function updatePolicyDraft(id, updates, root = POLICIES_ROOT) {
  return queue(id, root, async () => {
    const current = await read(draftPath(id, root), id);
    const policy = validatePolicy({ ...current, ...updates, id, version: current.version, status: 'draft', publishedAt: null, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
    await atomicWrite(draftPath(id, root), policy);
    return structuredClone(policy);
  });
}

export async function publishPolicy(id, root = POLICIES_ROOT) {
  return queue(id, root, async () => {
    const draft = await read(draftPath(id, root), id);
    if (await exists(versionPath(id, draft.version, root))) throw new PolicyStoreError('Policy version already exists.', 'POLICY_VERSION_EXISTS', 409);
    const now = new Date().toISOString();
    const published = validatePolicy({ ...draft, status: 'published', publishedAt: now, updatedAt: now });
    await atomicWrite(versionPath(id, published.version, root), published);
    await unlink(draftPath(id, root));
    await unlink(archivePath(id, root)).catch(() => {});
    return structuredClone(published);
  });
}

export async function createPolicyDraftVersion(id, root = POLICIES_ROOT) {
  return queue(id, root, async () => {
    if (await exists(draftPath(id, root))) throw new PolicyStoreError('A draft already exists.', 'POLICY_DRAFT_EXISTS', 409);
    const versions = await versionNumbers(id, root);
    if (!versions.length) throw new PolicyStoreError(`Policy ${id} was not found.`, 'POLICY_NOT_FOUND', 404);
    const latest = await read(versionPath(id, versions.at(-1), root), id);
    const draft = { ...latest, version: latest.version + 1, status: 'draft', publishedAt: null, updatedAt: new Date().toISOString() };
    await atomicWrite(draftPath(id, root), draft);
    await unlink(archivePath(id, root)).catch(() => {});
    return structuredClone(draft);
  });
}

export async function archivePolicy(id, root = POLICIES_ROOT) {
  return queue(id, root, async () => {
    const current = await readPolicy(id, undefined, root);
    await atomicWrite(archivePath(id, root), { archivedAt: new Date().toISOString() });
    return { ...current, status: 'archived' };
  });
}

export async function findApplicablePolicies({ agentId = '', toolId = '', workflowId = '' } = {}, root = POLICIES_ROOT) {
  const policies = await listPolicies({}, root);
  return policies.filter((policy) => policy.status === 'published' && (
    policy.scope.agents.includes(agentId) ||
    policy.scope.tools.includes(toolId) ||
    policy.scope.workflows.includes(workflowId) ||
    policy.scope.agents.includes('*') ||
    policy.scope.tools.includes('*') ||
    policy.scope.workflows.includes('*')
  ));
}

async function versionNumbers(id, root) {
  return (await readdir(dir(id, root)).catch(() => [])).map((name) => name.match(/^v(\d+)\.json$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
}

async function read(filePath, id) {
  try { return structuredClone(JSON.parse(await readFile(filePath, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') throw new PolicyStoreError(`Policy ${id} was not found.`, 'POLICY_NOT_FOUND', 404); throw error; }
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, filePath);
}

async function exists(filePath) {
  return import('node:fs/promises').then(({ stat }) => stat(filePath).then(() => true).catch(() => false));
}

function queue(id, root, operation) {
  assertId(id);
  const key = dir(id, root);
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(key, next);
  return next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
}

function assertId(id) {
  if (!/^policy_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(id || '')) throw new PolicyStoreError('Invalid policy id.', 'POLICY_ID_INVALID', 422);
}

function dir(id, root) { return path.join(root, id); }
function draftPath(id, root) { return path.join(dir(id, root), 'draft.json'); }
function versionPath(id, version, root) { return path.join(dir(id, root), `v${Number(version)}.json`); }
function archivePath(id, root) { return path.join(dir(id, root), 'archived.json'); }
