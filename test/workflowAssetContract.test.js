import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWorkflowAssets } from '../src/workflowAssetContract.js';

const resolver = {
  async resolveAgent(id) {
    if (id === 'missing') throw new Error('not found');
    return { id, version: 1, inputSchema: { type: 'object', required: ['request'], properties: { request: { type: 'string' } } }, outputSchema: { type: 'object', properties: { plan: { type: 'string' } } } };
  },
  async resolveTool(id) { return { id, version: 1, inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: {} } }; },
  async resolveWorkflow(id) { return { id, version: 1, inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: {} } }; }
};

test('resolves referenced assets and captures schemas', async () => {
  const result = await analyzeWorkflowAssets({ nodes: [{ id: 'plan', type: 'agent', agentId: 'planner', input: { request: '$input.request' } }] }, resolver);
  assert.deepEqual(result.errors, []);
  assert.equal(result.resolvedSchemas.plan.version, 1);
  assert.equal(result.resolvedSchemas.plan.outputSchema.properties.plan.type, 'string');
});

test('rejects missing assets and required input mappings', async () => {
  const result = await analyzeWorkflowAssets({ nodes: [
    { id: 'plan', type: 'agent', agentId: 'planner', input: {} },
    { id: 'missing', type: 'agent', agentId: 'missing', input: {} }
  ] }, resolver);
  assert.deepEqual(result.errors.map((item) => item.path), ['nodes[0].input.request', 'nodes[1].agentId']);
});
