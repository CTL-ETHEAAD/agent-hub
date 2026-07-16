import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTool } from '../src/toolStore.js';
import { executeTool } from '../src/toolService.js';

test('executes an HTTP tool without exposing resolved secrets', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tools-')); t.after(() => rm(root, { recursive: true, force: true }));
  await createTool({ id: 'lookup', name: 'Lookup', type: 'http', config: { url: 'https://api.example.com/items/{{id}}', method: 'GET', allowedHosts: ['api.example.com'], headers: { authorization: '$env.API_TOKEN' } }, secretEnv: ['API_TOKEN'], inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, outputSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } }, root);
  let request;
  const fetchImpl = async (url, options) => { request = { url, options }; return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"ok":true}' }; };
  const result = await executeTool('lookup', { id: 'a/b' }, { toolsRoot: root, fetchImpl, env: { API_TOKEN: 'secret' } });
  assert.deepEqual(result.output, { ok: true });
  assert.equal(request.url, 'https://api.example.com/items/a%2Fb');
  assert.equal(request.options.headers.authorization, 'secret');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('evaluates policy for workflow tool execution', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tools-')); t.after(() => rm(root, { recursive: true, force: true }));
  await createTool({ id: 'lookup', name: 'Lookup', type: 'http', config: { url: 'https://api.example.com/items/{{id}}', method: 'GET', allowedHosts: ['api.example.com'] }, inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, outputSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } }, root);
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"ok":true}' });
  const result = await executeTool('lookup', { id: '42' }, {
    toolsRoot: root,
    fetchImpl,
    mode: 'workflow',
    policies: [{
      id: 'policy_tool_default',
      version: 1,
      status: 'published',
      scope: { tools: ['*'], agents: [], workflows: [] },
      actions: { allow: ['tool.call'], deny: [], requiresApproval: [] },
      tools: { allow: ['tool.lookup'], deny: [] }
    }],
    runContext: { runId: 'wrun_00000000-0000-0000-0000-000000000000', nodeId: 'lookup', workflowId: 'wf' }
  });
  assert.equal(result.policyDecision.effect, 'allow');
  assert.ok(result.auditEvents.some((event) => event.type === 'policy.evaluated'));
});
