# Model Provider Guide

[简体中文](MODEL_PROVIDERS.md) | [English](MODEL_PROVIDERS.en.md)

The `runtime.provider` field in an Agent Definition selects the execution adapter. `runtime.model` stores the model ID recognized by that provider. Agent Hub is not restricted to Claude models.

## Claude Code

Install and authenticate Claude Code, then use:

```json
{
  "runtime": {
    "provider": "claude-code",
    "model": "",
    "timeoutMs": 600000
  }
}
```

An empty `model` uses the Claude Code default. Filesystem and shell access remain controlled by the Agent's `permissions` and `tools` declarations.

## OpenAI-compatible

Configure the environment first:

```bash
export OPENAI_COMPATIBLE_BASE_URL="https://api.openai.com/v1"
export OPENAI_API_KEY="..."
export AGENT_HUB_PROVIDER_ALLOWED_HOSTS="api.openai.com"
export AGENT_HUB_PROVIDER_SECRET_ENVS="OPENAI_API_KEY"
```

Agent Definition:

```json
{
  "runtime": {
    "provider": "openai-compatible",
    "model": "your-model-id",
    "baseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "timeoutMs": 600000
  },
  "permissions": {
    "filesystem": "deny",
    "network": "allow",
    "gitWrite": false
  }
}
```

The provider host and secret environment variable must appear in their respective process-level allowlists. Private-network, localhost, plain HTTP, and unauthorized endpoints are rejected before a secret is sent.

The current adapter calls `POST /chat/completions` and expects JSON model output. Services that only implement the Responses API require a new adapter.

## Custom Runtime Adapter

Implement the same return contract as the built-in Runtimes:

```js
import { registerAgentRuntime } from './src/agentRuntime.js';

const unregister = registerAgentRuntime('my-provider', async ({ agent, input, run }) => ({
  pid: 'provider-run-id',
  cancel() {},
  done: Promise.resolve({
    code: 0,
    output: { result: 'structured output' },
    usage: { inputTokens: null, outputTokens: null, costUsd: null }
  })
}));
```

The adapter owns cancellation, timeouts, network errors, and provider-response conversion. Agent Service owns input/output Schema validation, state transitions, and Traces.

## Troubleshooting

- `AGENT_RUNTIME_UNSUPPORTED`: the provider is not registered.
- `AGENT_NETWORK_DENIED`: the HTTP Runtime has no network permission.
- `AGENT_PROVIDER_ENDPOINT_DENIED`: the host is not allowlisted or resolves to a private network.
- `AGENT_PROVIDER_SECRET_DENIED`: `apiKeyEnv` is not allowlisted.
- `AGENT_RUNTIME_CONFIG_INVALID`: the endpoint, model, or secret is missing.
- `AGENT_OUTPUT_INVALID`: the model result does not satisfy the Agent output schema.
