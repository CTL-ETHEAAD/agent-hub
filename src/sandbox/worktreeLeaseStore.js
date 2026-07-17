import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { STATE_ROOT } from '../stateStore.js';

export const WORKTREE_LEASES_ROOT = process.env.AGENT_HUB_WORKTREE_LEASES_ROOT || path.join(STATE_ROOT, 'worktree-leases');

const ACTIVE = new Set(['active']);
const queues = new Map();

export class WorktreeLeaseError extends Error {
  constructor(message, code, status = 409) {
    super(message);
    this.name = 'WorktreeLeaseError';
    this.code = code;
    this.status = status;
  }
}

export async function acquireWorktreeLease({ worktreeKey, nodeRunId, workerId = '', ttlMs = 30 * 60 * 1000, metadata = {} }, root = WORKTREE_LEASES_ROOT) {
  if (!worktreeKey || !nodeRunId) throw new WorktreeLeaseError('worktreeKey and nodeRunId are required.', 'WORKTREE_LEASE_INVALID', 422);
  return queue(worktreeKey, async () => {
    const existing = await readLeaseByKey(worktreeKey, root).catch((error) => {
      if (error.code === 'WORKTREE_LEASE_NOT_FOUND') return null;
      throw error;
    });
    const now = new Date();
    if (existing && ACTIVE.has(existing.status) && new Date(existing.expiresAt) > now && existing.nodeRunId !== nodeRunId) {
      throw new WorktreeLeaseError(`Worktree ${worktreeKey} is already leased.`, 'WORKTREE_LEASE_CONFLICT');
    }
    const lease = {
      id: existing?.id || `wtlease_${randomUUID()}`,
      worktreeKey,
      nodeRunId,
      workerId,
      status: 'active',
      metadata: structuredClone(metadata),
      acquiredAt: existing?.acquiredAt || now.toISOString(),
      renewedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      releasedAt: null
    };
    await atomicWrite(leasePath(worktreeKey, root), lease);
    return structuredClone(lease);
  });
}

export async function releaseWorktreeLease(worktreeKey, { nodeRunId } = {}, root = WORKTREE_LEASES_ROOT) {
  return queue(worktreeKey, async () => {
    const lease = await readLeaseByKey(worktreeKey, root);
    if (nodeRunId && lease.nodeRunId !== nodeRunId) throw new WorktreeLeaseError('Worktree lease is owned by another node run.', 'WORKTREE_LEASE_OWNER_MISMATCH');
    const now = new Date().toISOString();
    const released = { ...lease, status: 'released', releasedAt: now, expiresAt: now };
    await atomicWrite(leasePath(worktreeKey, root), released);
    return structuredClone(released);
  });
}

export async function readLeaseByKey(worktreeKey, root = WORKTREE_LEASES_ROOT) {
  try {
    return structuredClone(JSON.parse(await readFile(leasePath(worktreeKey, root), 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') throw new WorktreeLeaseError(`Worktree lease ${worktreeKey} was not found.`, 'WORKTREE_LEASE_NOT_FOUND', 404);
    throw error;
  }
}

export async function listWorktreeLeases({ status } = {}, root = WORKTREE_LEASES_ROOT) {
  await mkdir(root, { recursive: true });
  const names = (await readdir(root)).filter((name) => name.endsWith('.json'));
  const leases = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'))));
  return leases.filter((lease) => !status || lease.status === status).sort((a, b) => b.renewedAt.localeCompare(a.renewedAt));
}

export async function recoverExpiredWorktreeLeases({ now = new Date() } = {}, root = WORKTREE_LEASES_ROOT) {
  const leases = await listWorktreeLeases({ status: 'active' }, root);
  return Promise.all(leases.filter((lease) => new Date(lease.expiresAt) <= now).map((lease) => releaseWorktreeLease(lease.worktreeKey, { nodeRunId: lease.nodeRunId }, root)));
}

export function deriveWorktreeKey({ workflowId = '', nodeId = '', repo = '', strategy = 'reuse' } = {}) {
  const stable = [workflowId, nodeId, repo, strategy].join(':');
  return createHash('sha256').update(stable).digest('hex').slice(0, 24);
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, filePath);
}

function queue(key, operation) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(key, next);
  return next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
}

function leasePath(worktreeKey, root) {
  const safe = createHash('sha256').update(worktreeKey).digest('hex');
  return path.join(root, `${safe}.json`);
}
