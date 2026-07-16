import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReference, validateWorkflow } from '../src/workflowSchema.js';

const valid = { id: 'review-flow', name: 'Review', nodes: [{ id: 'start', type: 'start' }, { id: 'review', type: 'agent', agentId: 'code-reviewer', input: { diff: '$input.diff' } }, { id: 'end', type: 'end', output: '$nodes.review.output' }], edges: [{ from: 'start', to: 'review' }, { from: 'review', to: 'end' }] };

test('validates a minimal workflow', () => assert.equal(validateWorkflow(valid).status, 'draft'));
test('rejects cycles and unreachable nodes', () => assert.throws(() => validateWorkflow({ ...valid, edges: [{ from: 'start', to: 'review' }, { from: 'review', to: 'start' }] }), /invalid/));
test('requires true and false condition branches', () => assert.throws(() => validateWorkflow({ ...valid, nodes: [{ id: 'start', type: 'start' }, { id: 'check', type: 'condition', value: '$input.ok', operator: 'equals', compare: true }, { id: 'end', type: 'end' }], edges: [{ from: 'start', to: 'check' }, { from: 'check', to: 'end', when: true }] }), /invalid/));
test('resolves input and node references', () => assert.equal(resolveReference('$nodes.review.output.ok', { input: {}, nodes: { review: { output: { ok: true } } } }), true));
test('preserves finite canvas positions', () => {
  const workflow = validateWorkflow({ ...valid, ui: { positions: { start: { x: 20, y: 40 } } } });
  assert.deepEqual(workflow.ui.positions.start, { x: 20, y: 40 });
  assert.throws(() => validateWorkflow({ ...valid, ui: { positions: { start: { x: 'left', y: 40 } } } }), /invalid/);
});
