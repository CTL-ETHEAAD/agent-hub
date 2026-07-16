# Model Provider Guide

[简体中文](MODEL_PROVIDERS.md) | [English](MODEL_PROVIDERS.en.md)

Agent Definition 的 `runtime.provider` 决定实际执行适配器，`runtime.model` 只保存 provider 能识别的模型 ID。Agent Hub 不把模型固定为 Claude。

## Claude Code

安装并完成 Claude Code 登录，然后创建：

```json
{
  "runtime": {
    "provider": "claude-code",
    "model": "",
    "timeoutMs": 600000
  }
}
```

空 `model` 表示使用 Claude Code 默认模型。文件和 Shell 权限仍由 Agent 的 `permissions` 与 `tools` 控制。

## OpenAI-compatible

先配置环境变量：

```bash
export OPENAI_COMPATIBLE_BASE_URL="https://api.openai.com/v1"
export OPENAI_API_KEY="..."
export AGENT_HUB_PROVIDER_ALLOWED_HOSTS="api.openai.com"
export AGENT_HUB_PROVIDER_SECRET_ENVS="OPENAI_API_KEY"
```

Agent Definition：

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

Provider host 和 secret env 必须分别出现在进程级 allowlist 中。私网、localhost、HTTP 和未授权 endpoint 会在发送密钥前被拒绝。

当前兼容接口为 `POST /chat/completions`，并要求模型输出 JSON。若服务只实现 Responses API，需要新增 Adapter。

## 自定义 Runtime Adapter

实现与现有 Runtime 相同的返回契约：

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

Adapter 必须负责取消、超时、网络错误和 provider 响应转换；Agent Service 负责输入输出 Schema 校验、状态转换和 Trace。

## 排错

- `AGENT_RUNTIME_UNSUPPORTED`：provider 未注册。
- `AGENT_NETWORK_DENIED`：HTTP Runtime 未获得 network 权限。
- `AGENT_PROVIDER_ENDPOINT_DENIED`：host 未进入 allowlist 或属于私网。
- `AGENT_PROVIDER_SECRET_DENIED`：`apiKeyEnv` 未进入 allowlist。
- `AGENT_RUNTIME_CONFIG_INVALID`：缺少 endpoint、模型或密钥。
- `AGENT_OUTPUT_INVALID`：模型返回结果不符合 Agent output schema。
