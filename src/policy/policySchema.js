const ID = /^policy_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const STATUSES = new Set(['draft', 'published', 'archived']);
const SANDBOX_MODES = new Set(['none', 'readonly', 'workspace-write', 'isolated-worktree']);
const FILESYSTEM = new Set(['deny', 'read-only', 'workspace-write']);
const NETWORK = new Set(['deny', 'allowlist', 'tool-only', 'allow']);
const WORKTREE = new Set(['reuse', 'fresh-per-run', 'fresh-per-node']);
const ACTIONS = new Set(['agent.run', 'tool.call', 'mcp.call', 'git.commit', 'git.push', 'github.pr.create', 'workflow.run', 'secret.bind', 'deploy.production']);
const MAX_NAME = 120;

export class PolicyValidationError extends Error {
  constructor(message, details = [], code = 'POLICY_INVALID') {
    super(message);
    this.name = 'PolicyValidationError';
    this.code = code;
    this.status = 422;
    this.details = details;
  }
}

export function normalizePolicy(input = {}, { now = new Date().toISOString() } = {}) {
  const value = structuredClone(input || {});
  return {
    id: typeof value.id === 'string' ? value.id.trim().toLowerCase() : '',
    name: typeof value.name === 'string' ? value.name.trim() : '',
    description: typeof value.description === 'string' ? value.description.trim() : '',
    version: Number.isInteger(value.version) ? value.version : 1,
    status: value.status || 'draft',
    scope: {
      agents: strings(value.scope?.agents),
      tools: strings(value.scope?.tools),
      workflows: strings(value.scope?.workflows)
    },
    sandbox: {
      mode: value.sandbox?.mode || 'none',
      filesystem: value.sandbox?.filesystem || 'deny',
      network: value.sandbox?.network || 'deny',
      gitWrite: value.sandbox?.gitWrite === true,
      worktreeStrategy: value.sandbox?.worktreeStrategy || 'reuse',
      allowedHosts: strings(value.sandbox?.allowedHosts)
    },
    tools: {
      allow: patterns(value.tools?.allow),
      deny: patterns(value.tools?.deny)
    },
    actions: {
      allow: actions(value.actions?.allow),
      deny: actions(value.actions?.deny),
      requiresApproval: actions(value.actions?.requiresApproval)
    },
    promptInjection: {
      wrapExternalContent: value.promptInjection?.wrapExternalContent !== false,
      blockInstructionFromUntrustedContext: value.promptInjection?.blockInstructionFromUntrustedContext !== false
    },
    limits: {
      maxToolCallsPerRun: value.limits?.maxToolCallsPerRun ?? 20,
      maxRuntimeMs: value.limits?.maxRuntimeMs ?? 1_800_000
    },
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
    publishedAt: value.publishedAt || null
  };
}

export function validatePolicy(input) {
  const policy = normalizePolicy(input);
  const details = [];
  if (!ID.test(policy.id)) details.push(field('id', 'Use policy_<lowercase_words>.'));
  if (!policy.name || policy.name.length > MAX_NAME) details.push(field('name', `Name is required and must be ${MAX_NAME} characters or fewer.`));
  if (!Number.isInteger(policy.version) || policy.version < 1) details.push(field('version', 'Version must be a positive integer.'));
  if (!STATUSES.has(policy.status)) details.push(field('status', 'Unsupported policy status.'));
  if (!SANDBOX_MODES.has(policy.sandbox.mode)) details.push(field('sandbox.mode', 'Unsupported sandbox mode.'));
  if (!FILESYSTEM.has(policy.sandbox.filesystem)) details.push(field('sandbox.filesystem', 'Unsupported filesystem permission.'));
  if (!NETWORK.has(policy.sandbox.network)) details.push(field('sandbox.network', 'Unsupported network mode.'));
  if (!WORKTREE.has(policy.sandbox.worktreeStrategy)) details.push(field('sandbox.worktreeStrategy', 'Unsupported worktree strategy.'));
  if (!Number.isInteger(policy.limits.maxToolCallsPerRun) || policy.limits.maxToolCallsPerRun < 0 || policy.limits.maxToolCallsPerRun > 10_000) details.push(field('limits.maxToolCallsPerRun', 'maxToolCallsPerRun must be between 0 and 10000.'));
  if (!Number.isInteger(policy.limits.maxRuntimeMs) || policy.limits.maxRuntimeMs < 1000 || policy.limits.maxRuntimeMs > 86_400_000) details.push(field('limits.maxRuntimeMs', 'maxRuntimeMs must be between 1000 and 86400000 ms.'));
  if (policy.status === 'published' && !policy.publishedAt) details.push(field('publishedAt', 'Published policies require publishedAt.'));
  if (policy.status === 'published' && !hasScope(policy.scope)) details.push(field('scope', 'Published policies require at least one scoped agent, tool, or workflow.'));
  if (details.length) throw new PolicyValidationError('Policy definition is invalid.', details);
  return policy;
}

export function matchesPattern(pattern, value) {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

function strings(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))] : [];
}

function patterns(value) {
  const items = strings(value);
  return items.filter((item) => item === '*' || /^[a-z0-9_.:-]+(?:\*)?$/.test(item));
}

function actions(value) {
  return strings(value).filter((item) => ACTIONS.has(item));
}

function hasScope(scope) {
  return Boolean(scope.agents.length || scope.tools.length || scope.workflows.length);
}

function field(path, message) {
  return { path, message };
}
