import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWorkflowContracts, getNodeContract, listNodeContracts, NODE_CONTRACT_VERSION } from '../src/workflowNodeContract.js';

const base = {
  inputSchema: { type: 'object', properties: { request: { type: 'string' } } },
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'plan', type: 'agent', agentId: 'planner', input: { request: '$input.request' }, outputSchema: { type: 'object', properties: { plan: { type: 'string' } } } },
    { id: 'implement', type: 'agent', agentId: 'implementer', input: { plan: '$nodes.plan.output.plan' } },
    { id: 'end', type: 'end', output: '$nodes.implement.output' }
  ],
  edges: [
    { from: 'start', to: 'plan' },
    { from: 'plan', to: 'implement' },
    { from: 'implement', to: 'end' }
  ]
};

test('publishes the Node Contract v1 catalog', () => {
  assert.equal(NODE_CONTRACT_VERSION, 1);
  assert.equal(listNodeContracts().length, 10);
  assert.deepEqual(getNodeContract('join'), { inputPort: 'branch', outputPort: 'control', minIncoming: 2, maxOutgoing: 1 });
});

test('accepts compatible upstream field mappings', () => {
  assert.deepEqual(analyzeWorkflowContracts(base).errors, []);
});

test('rejects unknown inputs, downstream references, and unknown output fields', () => {
  const workflow = structuredClone(base);
  workflow.nodes[1].input.request = '$input.missing';
  workflow.nodes[1].input.future = '$nodes.implement.output.value';
  workflow.nodes[2].input.plan = '$nodes.plan.output.missing';
  const paths = analyzeWorkflowContracts(workflow).errors.map((item) => item.path);
  assert.deepEqual(paths, ['nodes[1].input.request', 'nodes[1].input.future', 'nodes[2].input.plan']);
});

test('requires mappings declared by an inline input schema', () => {
  const workflow = structuredClone(base);
  workflow.nodes[2].inputSchema = { type: 'object', required: ['plan', 'repository'], properties: {} };
  assert.deepEqual(analyzeWorkflowContracts(workflow).errors.map((item) => item.path), ['nodes[2].input.repository']);
});
