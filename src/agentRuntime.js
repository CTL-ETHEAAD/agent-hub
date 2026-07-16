import { startClaudeCodeAgent } from './runtimes/claudeCodeAgentRuntime.js';
import { startOpenAiCompatibleAgent } from './runtimes/openAiCompatibleRuntime.js';

const adapters = new Map([['claude-code', startClaudeCodeAgent], ['openai-compatible', startOpenAiCompatibleAgent]]);

export function registerAgentRuntime(provider, adapter) {
  adapters.set(provider, adapter);
  return () => adapters.delete(provider);
}

export async function startAgentRuntime({ agent, input, run }) {
  const adapter = adapters.get(agent.runtime.provider);
  if (!adapter) {
    const error = new Error(`Unsupported runtime provider: ${agent.runtime.provider}`);
    error.code = 'AGENT_RUNTIME_UNSUPPORTED';
    error.status = 422;
    throw error;
  }
  return adapter({ agent, input, run });
}
