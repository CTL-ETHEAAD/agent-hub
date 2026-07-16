const FS_RANK = { deny: 0, 'read-only': 1, 'workspace-write': 2 };
const NETWORK_RANK = { deny: 0, 'tool-only': 1, allowlist: 2, allow: 3 };

export class SandboxPolicyError extends Error {
  constructor(message, code = 'SANDBOX_POLICY_INVALID', status = 422) {
    super(message);
    this.name = 'SandboxPolicyError';
    this.code = code;
    this.status = status;
  }
}

export function resolveSandbox({ policy = null, agent = null, workflow = null, node = null } = {}) {
  const base = {
    mode: 'none',
    filesystem: 'deny',
    network: 'deny',
    gitWrite: false,
    worktreeStrategy: 'reuse',
    allowedHosts: []
  };
  const policySandbox = policy?.sandbox || {};
  const agentPermissions = agent?.permissions || {};
  const workflowSandbox = workflow?.sandbox || {};
  const nodeSandbox = node?.sandbox || {};
  const resolved = merge(base, policySandbox);
  restrict(resolved, {
    filesystem: agentPermissions.filesystem,
    network: agentPermissions.network === 'allow' ? 'allow' : agentPermissions.network,
    gitWrite: agentPermissions.gitWrite
  });
  restrict(resolved, workflowSandbox);
  restrict(resolved, nodeSandbox);
  return resolved;
}

export function assertNoEscalation(parent, child) {
  if (rank(child.filesystem, FS_RANK) > rank(parent.filesystem, FS_RANK)) throw new SandboxPolicyError('Filesystem permission cannot escalate above parent sandbox.', 'SANDBOX_FILESYSTEM_ESCALATION');
  if (rank(child.network, NETWORK_RANK) > rank(parent.network, NETWORK_RANK)) throw new SandboxPolicyError('Network permission cannot escalate above parent sandbox.', 'SANDBOX_NETWORK_ESCALATION');
  if (child.gitWrite && !parent.gitWrite) throw new SandboxPolicyError('gitWrite cannot escalate above parent sandbox.', 'SANDBOX_GIT_ESCALATION');
}

function merge(target, source = {}) {
  const next = { ...target };
  for (const key of ['mode', 'filesystem', 'network', 'worktreeStrategy']) {
    if (source[key]) next[key] = source[key];
  }
  if (source.gitWrite !== undefined) next.gitWrite = source.gitWrite === true;
  if (Array.isArray(source.allowedHosts)) next.allowedHosts = [...new Set(source.allowedHosts)];
  return next;
}

function restrict(target, source = {}) {
  if (!source) return target;
  if (source.filesystem && rank(source.filesystem, FS_RANK) <= rank(target.filesystem, FS_RANK)) target.filesystem = source.filesystem;
  if (source.network && rank(source.network, NETWORK_RANK) <= rank(target.network, NETWORK_RANK)) target.network = source.network;
  if (source.gitWrite === false) target.gitWrite = false;
  if (Array.isArray(source.allowedHosts) && source.allowedHosts.length) target.allowedHosts = target.allowedHosts.filter((host) => source.allowedHosts.includes(host));
  return target;
}

function rank(value, table) {
  return table[value] ?? 0;
}
