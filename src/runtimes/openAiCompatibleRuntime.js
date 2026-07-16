import { randomUUID } from 'node:crypto';
import { buildAgentPrompt, parseStructuredOutput } from './claudeCodeAgentRuntime.js';

export async function startOpenAiCompatibleAgent({ agent, input }) {
  if (agent.permissions.network !== 'allow') throw runtimeError('OpenAI-compatible runtime requires network: allow.', 'AGENT_NETWORK_DENIED');
  const baseUrl = agent.runtime.baseUrl || process.env.OPENAI_COMPATIBLE_BASE_URL;
  const apiKeyEnv = agent.runtime.apiKeyEnv || 'OPENAI_API_KEY';
  assertProviderBinding(baseUrl, apiKeyEnv);
  const apiKey = process.env[apiKeyEnv];
  if (!baseUrl || !apiKey || !agent.runtime.model) throw runtimeError('OpenAI-compatible runtime requires baseUrl, apiKeyEnv, and model.', 'AGENT_RUNTIME_CONFIG_INVALID');
  const controller = new AbortController();
  const done = (async () => {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', signal: controller.signal, headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: agent.runtime.model, messages: [{ role: 'user', content: buildAgentPrompt(agent, input) }], response_format: { type: 'json_object' } }) });
      if (!response.ok) return { code: 1, error: `Provider returned HTTP ${response.status}.`, errorCode: 'AGENT_PROVIDER_FAILED' };
      const body = await response.json();
      return { code: 0, output: parseStructuredOutput(body.choices?.[0]?.message?.content), usage: { inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null, costUsd: null } };
    } catch (error) { return { code: 1, error: error.message, errorCode: 'AGENT_PROVIDER_FAILED' }; }
  })();
  return { pid: `http_${randomUUID()}`, done, cancel: () => controller.abort() };
}

function assertProviderBinding(baseUrl, apiKeyEnv) {
  let url;
  try { url = new URL(baseUrl); } catch { throw runtimeError('Provider baseUrl is invalid.', 'AGENT_PROVIDER_ENDPOINT_DENIED'); }
  const allowedHosts = new Set((process.env.AGENT_HUB_PROVIDER_ALLOWED_HOSTS || 'api.openai.com').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
  const allowedSecrets = new Set((process.env.AGENT_HUB_PROVIDER_SECRET_ENVS || 'OPENAI_API_KEY').split(',').map((value) => value.trim()).filter(Boolean));
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase()) || isPrivateHost(url.hostname)) throw runtimeError('Provider endpoint is not allowlisted.', 'AGENT_PROVIDER_ENDPOINT_DENIED');
  if (!allowedSecrets.has(apiKeyEnv)) throw runtimeError('Provider secret is not allowlisted.', 'AGENT_PROVIDER_SECRET_DENIED');
}

function isPrivateHost(host) { return host === 'localhost' || host.endsWith('.local') || /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host); }

function runtimeError(message, code) { const error = new Error(message); error.code = code; error.status = 422; return error; }
