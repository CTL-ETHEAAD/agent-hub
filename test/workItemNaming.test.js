import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorkItemPaths, normalizeWorkItemInput } from '../src/workItems/workItemNaming.js';

test('normalizes generic work item input without requiring issue-tracker semantics', () => {
  const item = normalizeWorkItemInput({
    externalId: 'Upload fix',
    title: 'Fix upload flow',
    source: { type: 'manual' }
  });
  assert.equal(item.workItemId, 'manual-Upload-fix');
  assert.equal(item.externalId, 'Upload fix');
  assert.equal(item.ticketId, 'Upload fix');
  assert.equal(item.source.type, 'manual');
});

test('derives generic branch, worktree, feature file, and artifact paths', () => {
  const item = normalizeWorkItemInput({ externalId: 'Upload fix', title: 'Fix upload flow' });
  const paths = deriveWorkItemPaths({
    item,
    repo: { repo: 'demo' },
    roots: {
      workItemsRoot: '/tmp/work-items',
      worktreeRoot: '/tmp/worktrees',
      artifactRoot: '/tmp/artifacts'
    }
  });
  assert.equal(paths.branch, 'agent/manual-Upload-fix-fix-upload-flow');
  assert.equal(paths.worktreePath, '/tmp/worktrees/demo/manual-Upload-fix');
  assert.equal(paths.featureFilePath, '/tmp/work-items/manual-Upload-fix-fix-upload-flow.md');
  assert.equal(paths.artifactDir, '/tmp/artifacts/manual-Upload-fix');
});
