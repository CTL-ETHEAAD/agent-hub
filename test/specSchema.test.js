import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../src/specSchema.js';

const validSpec = {
  id: 'tool-hub-spec',
  name: 'Tool Hub Spec',
  goal: 'Add a governed tool registry.',
  requirements: [
    { id: 'req-tool-registry', title: 'Registry', description: 'Users can register tools.', priority: 'must' }
  ],
  acceptanceCriteria: [
    { id: 'ac-register-tool', description: 'A tool can be registered and inspected.', verification: 'test' }
  ]
};

test('validates a minimal spec definition', () => {
  const spec = validateSpec(validSpec);
  assert.equal(spec.id, 'tool-hub-spec');
  assert.equal(spec.version, 1);
  assert.equal(spec.status, 'draft');
  assert.equal(spec.constraints.riskLevel, 'medium');
  assert.deepEqual(spec.workflowHints.requiredAgents, []);
});

test('rejects specs without acceptance criteria', () => {
  assert.throws(() => validateSpec({ ...validSpec, acceptanceCriteria: [] }), (error) => {
    assert.equal(error.code, 'SPEC_INVALID');
    assert.ok(error.details.some((detail) => detail.path === 'acceptanceCriteria'));
    return true;
  });
});

test('rejects duplicate requirement ids', () => {
  assert.throws(() => validateSpec({
    ...validSpec,
    requirements: [
      { id: 'req-a', title: 'A', description: 'A', priority: 'must' },
      { id: 'req-a', title: 'B', description: 'B', priority: 'should' }
    ]
  }), (error) => {
    assert.ok(error.details.some((detail) => detail.path === 'requirements[1].id'));
    return true;
  });
});
