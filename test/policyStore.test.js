import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPolicy, createPolicyDraftVersion, publishPolicy, readPolicy } from '../src/policy/policyStore.js';

test('stores immutable policy versions and draft versions', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'policies-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPolicy({ id: 'policy_tool_default', name: 'Tool policy', scope: { tools: ['*'] } }, root);
  const published = await publishPolicy('policy_tool_default', root);
  assert.equal(published.status, 'published');
  assert.equal((await readPolicy('policy_tool_default', 1, root)).status, 'published');
  const draft = await createPolicyDraftVersion('policy_tool_default', root);
  assert.equal(draft.version, 2);
});
