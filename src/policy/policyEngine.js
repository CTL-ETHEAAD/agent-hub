import { randomUUID } from 'node:crypto';
import { validateActionRequest } from '../kernel/actionSchema.js';
import { findApplicablePolicies } from './policyStore.js';
import { matchesPattern } from './policySchema.js';

const RISK_ORDER = ['low', 'medium', 'high', 'critical'];

export async function evaluateAction(input, options = {}) {
  const request = validateActionRequest(input);
  const policies = options.policies || await findApplicablePolicies({
    agentId: request.subject.agentId,
    toolId: request.resource.type === 'tool' ? request.resource.id : '',
    workflowId: request.subject.workflowId
  }, options.policiesRoot);
  if (!policies.length) {
    return decision({
      effect: options.compatibilityMode ? 'allow' : 'deny',
      riskLevel: classifyRisk(request),
      reason: options.compatibilityMode ? 'No published policy matched; compatibility mode allowed the action.' : 'No published policy matched the action.',
      policyId: 'policy_none',
      policyVersion: null
    });
  }
  const policy = policies[0];
  const riskLevel = maxRisk(classifyRisk(request), request.context?.tool?.attestation?.riskLevel);
  if (policy.actions.deny.includes(request.action) || matchesAny(policy.tools.deny, resourceKey(request))) {
    return decision({ effect: 'deny', riskLevel, reason: 'Action or resource is denied by policy.', policyId: policy.id, policyVersion: policy.version });
  }
  if (policy.actions.requiresApproval.includes(request.action) || request.context?.tool?.attestation?.requiresApproval === true) {
    return decision({ effect: 'requires_approval', riskLevel: maxRisk(riskLevel, 'high'), reason: 'Policy requires human approval before this action.', policyId: policy.id, policyVersion: policy.version });
  }
  if (policy.actions.allow.length && !policy.actions.allow.includes(request.action)) {
    return decision({ effect: 'deny', riskLevel, reason: 'Action is not in the policy allow list.', policyId: policy.id, policyVersion: policy.version });
  }
  if (policy.tools.allow.length && request.resource.type === 'tool' && !matchesAny(policy.tools.allow, resourceKey(request))) {
    return decision({ effect: 'deny', riskLevel, reason: 'Tool is not in the policy allow list.', policyId: policy.id, policyVersion: policy.version });
  }
  return decision({ effect: 'allow', riskLevel, reason: 'Action is allowed by policy.', policyId: policy.id, policyVersion: policy.version });
}

export function classifyRisk(request) {
  if (request.action === 'deploy.production') return 'critical';
  if (['git.commit', 'git.push', 'github.pr.create', 'secret.bind'].includes(request.action)) return 'high';
  if (request.action === 'mcp.call' && request.context?.tool?.attestation?.sideEffects === 'write') return 'high';
  if (request.action === 'tool.call') {
    const method = String(request.context?.tool?.config?.method || 'GET').toUpperCase();
    if (request.context?.tool?.attestation?.sideEffects === 'write') return 'high';
    if (request.context?.tool?.secretEnv?.length) return 'medium';
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? 'medium' : 'low';
  }
  if (request.action === 'agent.run' || request.action === 'workflow.run') return 'medium';
  return 'low';
}

function decision({ effect, riskLevel, reason, policyId, policyVersion }) {
  return {
    decisionId: `decision_${randomUUID()}`,
    effect,
    riskLevel,
    reason,
    policyId,
    policyVersion,
    requiresApproval: effect === 'requires_approval',
    at: new Date().toISOString()
  };
}

function resourceKey(request) {
  return `${request.resource.type}.${request.resource.id}`;
}

function matchesAny(patterns, value) {
  return patterns.some((pattern) => matchesPattern(pattern, value));
}

function maxRisk(...levels) {
  return levels.filter(Boolean).sort((a, b) => RISK_ORDER.indexOf(b) - RISK_ORDER.indexOf(a))[0] || 'low';
}
