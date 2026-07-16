const EFFECTS = new Set(['allow', 'deny', 'requires_approval']);
const ACTIONS = new Set(['agent.run', 'tool.call', 'mcp.call', 'git.commit', 'git.push', 'github.pr.create', 'workflow.run', 'secret.bind', 'deploy.production']);
const RESOURCE_TYPES = new Set(['agent', 'tool', 'mcp', 'git', 'github', 'workflow', 'secret', 'deployment']);
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);

export class KernelActionError extends Error {
  constructor(message, details = [], code = 'KERNEL_ACTION_INVALID') {
    super(message);
    this.name = 'KernelActionError';
    this.code = code;
    this.status = 422;
    this.details = details;
  }
}

export function normalizeActionRequest(input = {}) {
  const value = structuredClone(input);
  return {
    runId: string(value.runId),
    nodeId: string(value.nodeId),
    subject: {
      userId: string(value.subject?.userId || 'user_local'),
      agentId: string(value.subject?.agentId),
      workflowId: string(value.subject?.workflowId)
    },
    action: string(value.action),
    resource: {
      type: string(value.resource?.type),
      id: string(value.resource?.id),
      version: value.resource?.version ?? null
    },
    context: value.context && typeof value.context === 'object' && !Array.isArray(value.context) ? value.context : {}
  };
}

export function validateActionRequest(input) {
  const request = normalizeActionRequest(input);
  const details = [];
  if (!request.runId) details.push(field('runId', 'runId is required.'));
  if (!request.nodeId) details.push(field('nodeId', 'nodeId is required.'));
  if (!request.subject.userId) details.push(field('subject.userId', 'subject.userId is required.'));
  if (!ACTIONS.has(request.action)) details.push(field('action', 'Unsupported action.'));
  if (!RESOURCE_TYPES.has(request.resource.type)) details.push(field('resource.type', 'Unsupported resource type.'));
  if (!request.resource.id) details.push(field('resource.id', 'resource.id is required.'));
  if (details.length) throw new KernelActionError('Kernel action request is invalid.', details);
  return request;
}

export function normalizePolicyDecision(input = {}) {
  return {
    decisionId: string(input.decisionId),
    effect: input.effect || 'deny',
    riskLevel: input.riskLevel || 'medium',
    reason: string(input.reason),
    policyId: string(input.policyId),
    policyVersion: Number.isInteger(input.policyVersion) ? input.policyVersion : null,
    requiresApproval: input.requiresApproval === true || input.effect === 'requires_approval',
    at: input.at || new Date().toISOString()
  };
}

export function validatePolicyDecision(input) {
  const decision = normalizePolicyDecision(input);
  const details = [];
  if (!decision.decisionId) details.push(field('decisionId', 'decisionId is required.'));
  if (!EFFECTS.has(decision.effect)) details.push(field('effect', 'Unsupported policy effect.'));
  if (!RISK_LEVELS.has(decision.riskLevel)) details.push(field('riskLevel', 'Unsupported risk level.'));
  if (!decision.reason) details.push(field('reason', 'reason is required.'));
  if (details.length) throw new KernelActionError('Policy decision is invalid.', details, 'POLICY_DECISION_INVALID');
  return decision;
}

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function field(path, message) {
  return { path, message };
}
