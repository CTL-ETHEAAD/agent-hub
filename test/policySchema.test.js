import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolicy, validatePolicy } from '../src/policy/policySchema.js';

test('normalizes policy defaults', () => {
  const policy = normalizePolicy({ id: 'policy_coding_default', name: 'Coding' });
  assert.equal(policy.status, 'draft');
  assert.equal(policy.sandbox.filesystem, 'deny');
  assert.equal(policy.sandbox.network, 'deny');
  assert.equal(policy.promptInjection.wrapExternalContent, true);
});

test('requires scope before publish', () => {
  assert.throws(() => validatePolicy({ id: 'policy_empty', name: 'Empty', status: 'published', publishedAt: new Date().toISOString() }), /invalid/);
});

test('validates a published policy with sandbox and actions', () => {
  const policy = validatePolicy({
    id: 'policy_delivery_default',
    name: 'Delivery',
    status: 'published',
    publishedAt: new Date().toISOString(),
    scope: { workflows: ['work-item-planning'] },
    sandbox: { mode: 'readonly', filesystem: 'read-only', network: 'tool-only' },
    actions: { requiresApproval: ['git.push', 'github.pr.create'] }
  });
  assert.equal(policy.actions.requiresApproval.length, 2);
});
