import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { archiveTool, createTool, createToolDraftVersion, publishTool, readTool, updateToolDraft } from '../src/toolStore.js';

const tool = { id: 'status-api', name: 'Status', type: 'http', config: { url: 'https://api.example.com/status', method: 'GET', allowedHosts: ['api.example.com'] }, inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: {} } };
test('stores immutable tool versions and archive marker', async (t) => { const root = await mkdtemp(path.join(os.tmpdir(), 'tools-')); t.after(() => rm(root, { recursive: true, force: true })); await createTool(tool, root); await publishTool('status-api', root); await archiveTool('status-api', root); assert.equal((await readTool('status-api', 1, root)).status, 'published'); assert.equal((await createToolDraftVersion('status-api', root)).version, 2); });

test('persists compatibility metadata for a breaking tool version', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tools-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createTool(tool, root);
  await publishTool('status-api', root);
  await createToolDraftVersion('status-api', root);
  await updateToolDraft('status-api', { outputSchema: { type: 'object', required: [], properties: {} } }, root);
  const published = await publishTool('status-api', root);
  assert.equal(published.compatibility.previousVersion, 1);
  assert.equal(published.compatibility.breaking, false);
});
