import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('agent HTTP API supports lifecycle and validation errors', {
  timeout: 10_000,
  skip: process.env.RUN_HTTP_INTEGRATION !== 'true' && 'set RUN_HTTP_INTEGRATION=true where loopback sockets are allowed'
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-api-'));
  const port = 45_000 + Math.floor(Math.random() * 5_000);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_HUB_AGENTS_ROOT: path.join(root, 'agents'),
      AGENT_HUB_RUNS_ROOT: path.join(root, 'runs'),
      AGENT_HUB_RUN_LOGS_ROOT: path.join(root, 'logs')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('close', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_000))
    ]);
    await rm(root, { recursive: true, force: true });
  });
  await waitForServer(child, port);

  const definition = {
    id: 'api-agent',
    name: 'API Agent',
    systemPrompt: 'Return JSON.',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: {} }
  };
  let response = await fetch(`http://127.0.0.1:${port}/api/agents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(definition) });
  assert.equal(response.status, 201);
  response = await fetch(`http://127.0.0.1:${port}/api/agents`);
  assert.equal((await response.json()).length, 1);
  response = await fetch(`http://127.0.0.1:${port}/api/agents/api-agent/publish`, { method: 'POST' });
  assert.equal(response.status, 200);
  response = await fetch(`http://127.0.0.1:${port}/api/agents/api-agent/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'AGENT_INPUT_INVALID');
});

function waitForServer(child, port) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start.')), 5_000);
    child.on('error', reject);
    child.stderr.on('data', (chunk) => reject(new Error(chunk.toString())));
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes(`:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}
