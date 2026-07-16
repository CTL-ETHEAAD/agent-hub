import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSkillDefinition } from '../src/skillSchema.js';

const valid = {
  id: 'review-packet', name: 'Review Packet', description: 'Reviews a change.', instructionPath: 'templates/skills/review-packet/SKILL.md',
  inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: {} }, allowedTools: ['repo.read'], riskNotes: ['Redact secrets.']
};

test('normalizes a valid versioned Skill definition', () => {
  const skill = validateSkillDefinition(valid);
  assert.equal(skill.status, 'draft');
  assert.equal(skill.version, 1);
  assert.deepEqual(skill.allowedTools, ['repo.read']);
});

test('rejects unsafe instruction paths and invalid Skill fields', () => {
  assert.throws(() => validateSkillDefinition({ ...valid, instructionPath: '../private/SKILL.md', unexpected: true }), (error) => {
    assert.equal(error.code, 'SKILL_INVALID');
    assert.ok(error.details.some((item) => item.path === 'instructionPath'));
    assert.ok(error.details.some((item) => item.path === 'unexpected'));
    return true;
  });
});
