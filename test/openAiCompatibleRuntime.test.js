import test from 'node:test';
import assert from 'node:assert/strict';
import { startOpenAiCompatibleAgent } from '../src/runtimes/openAiCompatibleRuntime.js';

const agent = {
  runtime: { baseUrl: 'https://127.0.0.1/v1', apiKeyEnv: 'OPENAI_API_KEY', model: 'test-model' },
  permissions: { network: 'allow' }, systemPrompt: 'Return JSON.', outputSchema: { type: 'object' }, skills: []
};

test('rejects private or non-allowlisted provider endpoints before sending a secret', async () => {
  await assert.rejects(startOpenAiCompatibleAgent({ agent, input: {} }), (error) => error.code === 'AGENT_PROVIDER_ENDPOINT_DENIED');
});

test('rejects provider secret names outside the process allowlist', async () => {
  await assert.rejects(startOpenAiCompatibleAgent({ agent: { ...agent, runtime: { ...agent.runtime, baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'UNTRUSTED_SECRET' } }, input: {} }), (error) => error.code === 'AGENT_PROVIDER_SECRET_DENIED');
});
