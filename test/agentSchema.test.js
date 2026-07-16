import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgentDefinition, validateValueAgainstSchema } from '../src/agentSchema.js';

const valid = { id: 'code-reviewer', name: 'Code Reviewer', systemPrompt: 'Review code.', inputSchema: { type: 'object', required: ['diff'], properties: { diff: { type: 'string' } } }, outputSchema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'string' } } } } };

test('normalizes a valid agent with safe defaults', () => {
  const agent = validateAgentDefinition(valid);
  assert.equal(agent.status, 'draft');
  assert.equal(agent.permissions.filesystem, 'deny');
  assert.equal(agent.runtime.provider, 'claude-code');
});

test('accepts unique versioned Skill references and rejects malformed references', () => {
  assert.deepEqual(validateAgentDefinition({ ...valid, skills: [{ id: 'review-packet', version: 1 }] }).skills, [{ id: 'review-packet', version: 1 }]);
  assert.throws(() => validateAgentDefinition({ ...valid, skills: [{ id: 'Review Packet', version: 0 }] }), /invalid/);
});

test('returns field details for invalid definitions', () => {
  assert.throws(() => validateAgentDefinition({ id: '../oops', name: '', systemPrompt: '' }), (error) => {
    assert.equal(error.code, 'AGENT_INVALID');
    assert.ok(error.details.some((item) => item.path === 'id'));
    assert.ok(error.details.some((item) => item.path === 'name'));
    return true;
  });
});

test('validates nested input and enums', () => {
  const schema = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'object', required: ['severity'], properties: { severity: { type: 'string', enum: ['high', 'low'] } } } } } };
  assert.deepEqual(validateValueAgainstSchema({ items: [{ severity: 'high' }] }, schema), { items: [{ severity: 'high' }] });
  assert.throws(() => validateValueAgainstSchema({ items: [{ severity: 'medium' }] }, schema), /does not match/);
});

test('rejects unsupported schema keywords', () => {
  assert.throws(() => validateValueAgainstSchema('x', { type: 'string', pattern: 'x' }), (error) => error.details[0].path === 'schema.pattern');
});
