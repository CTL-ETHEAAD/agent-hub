const SENSITIVE_KEYS = /authorization|proxy-authorization|x-api-key|api-key|token|secret|password/i;

export function createAuditEvent(type, payload = {}, { now = new Date().toISOString() } = {}) {
  if (typeof type !== 'string' || !type.trim()) throw error('Audit event type is required.', 'AUDIT_EVENT_TYPE_INVALID');
  return {
    type,
    ...redact(payload),
    at: payload.at || now
  };
}

export function policyEvaluatedEvent({ nodeId, decision }) {
  return createAuditEvent('policy.evaluated', { nodeId, decision });
}

export function sandboxResolvedEvent({ nodeId, sandbox }) {
  return createAuditEvent('sandbox.resolved', { nodeId, sandbox });
}

export function approvalRequestedEvent({ nodeId, approval }) {
  return createAuditEvent('approval.requested', { nodeId, approval });
}

export function redact(value) {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(item)]));
  }
  if (typeof value === 'string' && value.startsWith('$env.')) return '$env.[REDACTED]';
  return value;
}

function error(message, code) {
  const value = new Error(message);
  value.code = code;
  value.status = 422;
  return value;
}
