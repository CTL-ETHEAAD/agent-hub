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
