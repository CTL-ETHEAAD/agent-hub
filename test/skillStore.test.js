import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { archiveSkill, createSkill, createSkillDraftVersion, listSkills, publishSkill, readSkill, updateSkillDraft } from '../src/skillStore.js';

const definition = () => ({ id: 'review-packet', name: 'Review Packet', description: 'Reviews a change.', instructionPath: 'templates/skills/review-packet/SKILL.md', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: {} } });

test('creates, publishes, versions, and archives a Skill', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createSkill(definition(), root);
  await updateSkillDraft('review-packet', { description: 'Updated review guidance.' }, root);
  assert.equal((await publishSkill('review-packet', root)).status, 'published');
  assert.equal((await createSkillDraftVersion('review-packet', root)).version, 2);
  await archiveSkill('review-packet', root);
  assert.equal((await readSkill('review-packet', undefined, root)).status, 'archived');
  assert.equal((await listSkills({}, root)).length, 0);
});
