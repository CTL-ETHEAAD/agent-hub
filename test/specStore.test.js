import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { archiveSpec, createSpec, createSpecDraftVersion, listSpecVersions, publishSpec, readSpec, updateSpecDraft } from '../src/specStore.js';

const specInput = {
  id: 'planning-spec',
  name: 'Planning Spec',
  goal: 'Plan an implementation safely.',
  requirements: [
    { id: 'req-plan', title: 'Plan', description: 'Create a clear implementation plan.', priority: 'must' }
  ],
  acceptanceCriteria: [
    { id: 'ac-plan-reviewed', description: 'The plan is reviewed before execution.', verification: 'review' }
  ]
};

test('creates, publishes, versions, and archives specs', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spec-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const draft = await createSpec(specInput, root);
  assert.equal(draft.status, 'draft');

  const updated = await updateSpecDraft('planning-spec', { goal: 'Plan and validate an implementation safely.' }, root);
  assert.equal(updated.goal, 'Plan and validate an implementation safely.');

  const published = await publishSpec('planning-spec', root);
  assert.equal(published.status, 'published');
  assert.equal(published.version, 1);

  const nextDraft = await createSpecDraftVersion('planning-spec', root);
  assert.equal(nextDraft.version, 2);

  const versions = await listSpecVersions('planning-spec', root);
  assert.deepEqual(versions.map((spec) => spec.version), [1, 2]);

  const archived = await archiveSpec('planning-spec', root);
  assert.equal(archived.status, 'archived');
  assert.equal((await readSpec('planning-spec', undefined, root)).status, 'archived');
});
