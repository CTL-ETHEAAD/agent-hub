import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoEscalation, resolveSandbox } from '../src/sandbox/sandboxPolicy.js';

test('resolves sandbox from policy and agent restrictions', () => {
  const sandbox = resolveSandbox({
    policy: { sandbox: { mode: 'isolated-worktree', filesystem: 'workspace-write', network: 'allow', gitWrite: true, worktreeStrategy: 'fresh-per-run' } },
    agent: { permissions: { filesystem: 'read-only', network: 'deny', gitWrite: false } }
  });
  assert.equal(sandbox.filesystem, 'read-only');
  assert.equal(sandbox.network, 'deny');
  assert.equal(sandbox.gitWrite, false);
  assert.equal(sandbox.worktreeStrategy, 'fresh-per-run');
});

test('rejects sandbox privilege escalation', () => {
  assert.throws(() => assertNoEscalation(
    { filesystem: 'read-only', network: 'deny', gitWrite: false },
    { filesystem: 'workspace-write', network: 'deny', gitWrite: false }
  ), /Filesystem/);
});
