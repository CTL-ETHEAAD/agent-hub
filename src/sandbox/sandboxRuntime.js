import { resolveSandbox } from './sandboxPolicy.js';
import { acquireWorktreeLease, deriveWorktreeKey, releaseWorktreeLease } from './worktreeLeaseStore.js';

const WORKTREE_NODE_TYPES = new Set(['agent', 'feature']);

export async function prepareNodeRunSandbox(nodeRun, options = {}) {
  const sandbox = resolveSandbox({
    policy: options.policy,
    agent: options.agent,
    workflow: options.workflow,
    node: nodeRun.nodeSnapshot
  });
  const snapshot = {
    sandbox,
    worktreeLease: null,
    resolvedAt: new Date().toISOString()
  };
  if (requiresWorktreeLease(nodeRun, sandbox)) {
    const worktreeKey = deriveWorktreeKey({
      workflowId: nodeRun.workflowId,
      nodeId: sandbox.worktreeStrategy === 'fresh-per-run' ? nodeRun.workflowRunId : nodeRun.nodeId,
      repo: nodeRun.input?.repo || nodeRun.nodeSnapshot?.repo || '',
      strategy: sandbox.worktreeStrategy
    });
    snapshot.worktreeLease = await acquireWorktreeLease({
      worktreeKey,
      nodeRunId: nodeRun.id,
      workerId: options.workerId || '',
      ttlMs: options.worktreeLeaseMs || 30 * 60 * 1000,
      metadata: { workflowId: nodeRun.workflowId, workflowRunId: nodeRun.workflowRunId, nodeId: nodeRun.nodeId }
    }, options.worktreeLeasesRoot);
  }
  return snapshot;
}

export async function releaseNodeRunSandbox(snapshot, nodeRun, options = {}) {
  if (!snapshot?.worktreeLease) return null;
  return releaseWorktreeLease(snapshot.worktreeLease.worktreeKey, { nodeRunId: nodeRun.id }, options.worktreeLeasesRoot);
}

export function requiresWorktreeLease(nodeRun, sandbox) {
  if (!WORKTREE_NODE_TYPES.has(nodeRun.nodeType)) return false;
  return sandbox.mode === 'isolated-worktree' || sandbox.worktreeStrategy === 'fresh-per-node' || sandbox.worktreeStrategy === 'fresh-per-run' || sandbox.filesystem === 'workspace-write' || sandbox.gitWrite === true;
}
