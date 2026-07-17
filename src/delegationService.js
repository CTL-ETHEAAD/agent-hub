import { startAgentRun, listAgentRuns, readAgentRun, cancelAgentRun } from './agentService.js';

export class DelegationError extends Error {
  constructor(message, code, status = 409) {
    super(message);
    this.name = 'DelegationError';
    this.code = code;
    this.status = status;
  }
}

export async function delegateAgentRun(parentRunId, { agentId, input = {}, reason = '' } = {}, options = {}) {
  if (!agentId) throw new DelegationError('agentId is required.', 'DELEGATION_AGENT_REQUIRED', 422);
  const parent = await readAgentRun(parentRunId, options.runsRoot);
  const policy = normalizeDelegationPolicy(options.delegationPolicy || {});
  const rootRunId = parent.rootRunId || parent.id;
  const depth = (parent.depth || 0) + 1;
  if (depth > policy.maxDepth) throw new DelegationError('Delegation depth limit exceeded.', 'DELEGATION_DEPTH_EXCEEDED');
  if (policy.allowedAgents.length && !policy.allowedAgents.includes(agentId)) throw new DelegationError(`Agent ${agentId} is not delegate-allowlisted.`, 'DELEGATION_AGENT_DENIED', 403);
  const existingChildren = (await listAgentRuns({}, options.runsRoot)).filter((run) => run.parentRunId === parent.id);
  if (existingChildren.length >= policy.maxChildrenPerRun) throw new DelegationError('Delegation child run limit exceeded.', 'DELEGATION_CHILD_LIMIT_EXCEEDED');
  return startAgentRun(agentId, input, {
    ...options,
    rootRunId,
    parentRunId: parent.id,
    depth,
    delegationReason: reason || 'Delegated by parent agent.'
  });
}

export async function getAgentRunTree(rootRunId, options = {}) {
  const runs = await listAgentRuns({}, options.runsRoot);
  const root = runs.find((run) => run.id === rootRunId || run.rootRunId === rootRunId && !run.parentRunId);
  const targetRootId = root?.id || rootRunId;
  const members = runs.filter((run) => run.id === targetRootId || run.rootRunId === targetRootId);
  return buildTree(targetRootId, members);
}

export async function cancelAgentRunTree(rootRunId, options = {}) {
  const tree = await getAgentRunTree(rootRunId, options);
  const flat = flatten(tree);
  const cancelled = [];
  for (const item of flat.reverse()) {
    if (['queued', 'running'].includes(item.status)) {
      cancelled.push(await cancelAgentRun(item.id, options).catch((error) => ({ id: item.id, error: { code: error.code, message: error.message } })));
    }
  }
  return cancelled;
}

function normalizeDelegationPolicy(policy) {
  return {
    maxDepth: Number.isInteger(policy.maxDepth) ? policy.maxDepth : 2,
    maxChildrenPerRun: Number.isInteger(policy.maxChildrenPerRun) ? policy.maxChildrenPerRun : 5,
    allowedAgents: Array.isArray(policy.allowedAgents) ? policy.allowedAgents.filter((item) => typeof item === 'string') : []
  };
}

function buildTree(rootRunId, runs) {
  const byParent = new Map();
  for (const run of runs) byParent.set(run.parentRunId || '', [...(byParent.get(run.parentRunId || '') || []), run]);
  const root = runs.find((run) => run.id === rootRunId) || runs[0] || { id: rootRunId, status: 'missing' };
  return attach(root, byParent);
}

function attach(run, byParent) {
  return {
    ...run,
    children: (byParent.get(run.id) || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((child) => attach(child, byParent))
  };
}

function flatten(node) {
  return [node, ...(node.children || []).flatMap(flatten)];
}
