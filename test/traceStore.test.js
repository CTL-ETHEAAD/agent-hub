import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendTrace, listTraceRunIds, listTraces } from '../src/trace/traceStore.js';

test('appends traces and redacts secret-like payload keys', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'traces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runId = 'wrun_00000000-0000-0000-0000-000000000000';
  await appendTrace(runId, { nodeId: 'lookup', type: 'tool.call.completed', payload: { token: 'secret', ok: true } }, root);
  const traces = await listTraces(runId, root);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].payload.token, '[REDACTED]');
  assert.equal(traces[0].payload.ok, true);
});

test('supports standalone Agent Run traces', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'traces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runId = 'run_00000000-0000-0000-0000-000000000000';
  await appendTrace(runId, { type: 'agent.run.completed', agentId: 'code-reviewer' }, root);
  assert.deepEqual(await listTraceRunIds(root), [runId]);
});
