import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSchemaCompatibility } from '../src/schemaCompatibility.js';

const version = (number, inputSchema, outputSchema) => ({ version: number, inputSchema, outputSchema });

test('marks the first published version as a compatible baseline', () => {
  const report = analyzeSchemaCompatibility(null, version(1, { type: 'object' }, { type: 'object' }), '2026-01-01T00:00:00.000Z');
  assert.deepEqual(report, { previousVersion: null, breaking: false, changes: [], checkedAt: '2026-01-01T00:00:00.000Z' });
});

test('detects breaking input and output changes recursively', () => {
  const previous = version(1,
    { type: 'object', properties: { request: { type: 'string', enum: ['a', 'b'] } }, required: ['request'] },
    { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] });
  const current = version(2,
    { type: 'object', properties: { request: { type: 'number', enum: ['a'] }, context: { type: 'string' } }, required: ['request', 'context'], additionalProperties: false },
    { type: 'object', properties: {} });
  const report = analyzeSchemaCompatibility(previous, current, '2026-01-01T00:00:00.000Z');
  assert.equal(report.breaking, true);
  assert.deepEqual(report.changes.map((item) => item.kind), [
    'additional-properties-restricted', 'required-added', 'type-changed', 'enum-narrowed', 'required-removed', 'property-removed'
  ]);
});
