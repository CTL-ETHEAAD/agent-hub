import { validateActionRequest } from './actionSchema.js';
import { evaluateAction } from '../policy/policyEngine.js';
import { createAuditEvent, policyEvaluatedEvent } from '../audit/auditEvent.js';

export async function prepareGovernedAction(input, options = {}) {
  const request = validateActionRequest(input);
  const decision = await (options.evaluateAction || evaluateAction)(request, options.policyOptions || {});
  const events = [
    policyEvaluatedEvent({ nodeId: request.nodeId, decision })
  ];
  if (decision.effect === 'deny') {
    events.push(createAuditEvent('policy.denied', { nodeId: request.nodeId, decision }));
    throw policyError(decision, events);
  }
  if (decision.effect === 'requires_approval') {
    events.push(createAuditEvent('policy.requires_approval', { nodeId: request.nodeId, decision }));
  }
  return { request, decision, events };
}

export function assertGovernedActionAllowed(decision) {
  if (!decision || decision.effect !== 'allow') {
    throw policyError(decision || { reason: 'Missing allow policy decision.', effect: 'deny', riskLevel: 'medium', policyId: 'policy_missing' }, []);
  }
}

function policyError(decision, events) {
  const error = new Error(decision.reason || 'Policy denied the action.');
  error.code = decision.effect === 'requires_approval' ? 'POLICY_APPROVAL_REQUIRED' : 'POLICY_DENIED';
  error.status = decision.effect === 'requires_approval' ? 409 : 403;
  error.policyDecision = decision;
  error.auditEvents = events;
  return error;
}
