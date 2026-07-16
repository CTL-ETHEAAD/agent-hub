import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAction } from '../src/policy/policyEngine.js';
import { validatePolicy } from '../src/policy/policySchema.js';

const policy = validatePolicy({
  id: 'policy_tool_default',
  name: 'Tool policy',
  status: 'published',
  publishedAt: new Date().toISOString(),
  scope: { tools: ['*'] },
  tools: { allow: ['tool.lookup'] },
  actions: { allow: ['tool.call'], requiresApproval: ['github.pr.create'] }
});

test('allows a matching low-risk tool call', async () => {
  const decision = await evaluateAction(request('tool.call', 'tool', 'lookup'), { policies: [policy] });
  assert.equal(decision.effect, 'allow');
  assert.equal(decision.riskLevel, 'low');
});

test('denies a tool outside the allow list', async () => {
  const decision = await evaluateAction(request('tool.call', 'tool', 'danger'), { policies: [policy] });
  assert.equal(decision.effect, 'deny');
});

test('requires approval for configured high-risk actions', async () => {
  const decision = await evaluateAction(request('github.pr.create', 'github', 'repo'), { policies: [{ ...policy, actions: { ...policy.actions, allow: [], requiresApproval: ['github.pr.create'] } }] });
  assert.equal(decision.effect, 'requires_approval');
  assert.equal(decision.requiresApproval, true);
});

test('denies by default when no policy matches', async () => {
  const decision = await evaluateAction(request('tool.call', 'tool', 'lookup'), { policies: [] });
  assert.equal(decision.effect, 'deny');
});

function request(action, type, id) {
  return {
    runId: 'wrun_00000000-0000-0000-0000-000000000000',
    nodeId: 'node',
    subject: { userId: 'user_local', workflowId: 'wf' },
    action,
    resource: { type, id, version: 1 },
    context: { tool: { config: { method: 'GET' } } }
  };
}
