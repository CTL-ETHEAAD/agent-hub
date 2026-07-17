import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { archiveWorkflow, createWorkflow, createWorkflowDraftVersion, publishWorkflow, readWorkflow, updateWorkflowDraft } from '../src/workflowStore.js';

const definition = { id: 'simple-flow', name: 'Simple', nodes: [{ id: 'start', type: 'start' }, { id: 'end', type: 'end', output: '$input' }], edges: [{ from: 'start', to: 'end' }] };

test('persists immutable workflow versions and archive marker', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workflows-')); t.after(() => rm(root, { recursive: true, force: true }));
  await createWorkflow(definition, root);
  await updateWorkflowDraft('simple-flow', { description: 'updated' }, root);
  await publishWorkflow('simple-flow', root);
  await archiveWorkflow('simple-flow', root);
  assert.equal((await readWorkflow('simple-flow', 1, root)).status, 'published');
  assert.equal((await readWorkflow('simple-flow', undefined, root)).status, 'archived');
  assert.equal((await createWorkflowDraftVersion('simple-flow', root)).version, 2);
});

test('pins resolved asset versions when publishing a workflow', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workflows-')); t.after(() => rm(root, { recursive: true, force: true }));
  await createWorkflow({
    id: 'versioned-flow',
    name: 'Versioned',
    inputSchema: { type: 'object', required: ['request'], properties: { request: { type: 'string' } } },
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'plan', type: 'agent', agentId: 'planner', input: { request: '$input.request' } },
      { id: 'end', type: 'end', output: '$nodes.plan.output' }
    ],
    edges: [{ from: 'start', to: 'plan' }, { from: 'plan', to: 'end' }]
  }, root);
  const resolver = {
    resolveAgent: async () => ({ id: 'planner', version: 3, inputSchema: { type: 'object', required: ['request'], properties: { request: { type: 'string' } } } }),
    resolveTool: async () => { throw new Error('unexpected tool resolution'); },
    resolveWorkflow: async () => { throw new Error('unexpected workflow resolution'); }
  };

  const published = await publishWorkflow('versioned-flow', root, resolver);

  assert.equal(published.nodes.find((node) => node.id === 'plan').agentVersion, 3);
  assert.equal((await readWorkflow('versioned-flow', 1, root)).nodes.find((node) => node.id === 'plan').agentVersion, 3);
});
