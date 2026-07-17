import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { archiveAgent, cloneAgent, createAgent, createDraftVersion, listAgentVersions, listAgents, publishAgent, readAgent, updateDraft } from '../src/agentStore.js';

const definition = (id = 'code-reviewer') => ({ id, name: 'Code Reviewer', systemPrompt: 'Review code.', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: {} } });

test('creates, updates, publishes, and versions an agent', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createAgent(definition(), root);
  await updateDraft('code-reviewer', { description: 'Updated' }, root);
  const v1 = await publishAgent('code-reviewer', root);
  assert.equal(v1.status, 'published');
  const draft = await createDraftVersion('code-reviewer', root);
  assert.equal(draft.version, 2);
  assert.equal((await listAgentVersions('code-reviewer', root)).length, 2);
  assert.equal((await readAgent('code-reviewer', 1, root)).description, 'Updated');
});

test('clones and archives without deleting history', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createAgent(definition(), root);
  await cloneAgent('code-reviewer', { id: 'review-copy' }, root);
  await archiveAgent('review-copy', root);
  assert.equal((await listAgents({}, root)).length, 1);
  assert.equal((await listAgents({ includeArchived: true }, root)).length, 2);
});

test('archiving does not mutate an immutable published version', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createAgent(definition(), root);
  const published = await publishAgent('code-reviewer', root);
  await archiveAgent('code-reviewer', root);
  assert.equal((await readAgent('code-reviewer', 1, root)).status, 'published');
  assert.equal((await readAgent('code-reviewer', undefined, root)).status, 'archived');
  assert.equal((await readAgent('code-reviewer', 1, root)).publishedAt, published.publishedAt);
});

test('rejects duplicate agents and published version overwrite', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createAgent(definition(), root);
  await assert.rejects(createAgent(definition(), root), (error) => error.code === 'AGENT_EXISTS');
  await publishAgent('code-reviewer', root);
  await assert.rejects(publishAgent('code-reviewer', root), (error) => error.code === 'AGENT_NOT_FOUND');
});

test('persists compatibility metadata for a breaking agent version', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createAgent(definition(), root);
  await publishAgent('code-reviewer', root);
  await createDraftVersion('code-reviewer', root);
  await updateDraft('code-reviewer', { inputSchema: { type: 'object', required: ['repository'], properties: { repository: { type: 'string' } } } }, root);
  const published = await publishAgent('code-reviewer', root);
  assert.equal(published.compatibility.previousVersion, 1);
  assert.equal(published.compatibility.breaking, true);
  assert.equal((await readAgent('code-reviewer', 2, root)).compatibility.changes[0].kind, 'required-added');
});
