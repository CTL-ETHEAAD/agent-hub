# Independent Modules

[简体中文](MODULES.md) | [English](MODULES.en.md)

Agent Hub 当前是单进程部署，但多数模块已经可以独立测试、替换或未来服务化。

| 模块 | 入口 | 可独立运行 | 主要依赖 |
|---|---|---:|---|
| Agent Registry | `agentSchema.js`, `agentStore.js` | 是 | filesystem |
| Agent Runtime | `agentService.js`, `agentRuntime.js` | 是 | Agent Store、Runtime Adapter、Trace |
| Skill Registry | `skillSchema.js`, `skillStore.js` | 是 | filesystem |
| Workflow Registry | `workflowSchema.js`, `workflowStore.js` | 是 | filesystem |
| Workflow Runtime | `workflowService.js` | 基本可以 | Agent、Tool、Workflow Run Store；全节点治理尚未统一 |
| Tool Hub | `toolSchema.js`, `toolStore.js`, `toolService.js` | 是 | Policy、fetch、environment secrets |
| Policy Engine | `policy/*` | 是 | Policy Store |
| Sandbox Resolver | `sandbox/sandboxPolicy.js` | 是 | Policy/Agent/Workflow declarations |
| Trace Store | `trace/traceStore.js` | 是 | filesystem |
| Work Item Orchestrator | `orchestrator.js` | 否，属聚合层 | repo、runtime、state、review、delivery |
| Delivery Service | `deliveryService.js` | 是 | Git/GitHub CLI、approved Work Item |
| Web/API | `server.js`, `public/*` | 否，属组合入口 | 所有应用服务 |

## Dependency direction

```text
Schema / Store
  → Domain Service
    → Runtime Adapter
      → Workflow / Orchestrator
        → HTTP API / UI
```

底层模块不应 import UI 或 server。Policy 只作决策，不执行副作用。Runtime Adapter 执行已解析的权限，不自行制定治理规则。

## 独立部署建议

优先拆分边界：

1. Tool Runtime / MCP Gateway：网络和密钥边界最清晰。
2. Trace/Eval Service：高写入量，可独立扩容。
3. Policy/Approval Service：组织级治理需要统一决策源。
4. Agent Runtime Workers：需要队列、租约、心跳和 sandbox。

Registry 和 Store 在早期可以继续内嵌；Work Item Orchestrator 保留为应用层协调器。

## 模块测试

每个模块均有对应 `test/*.test.js`。完整验证运行：

```bash
npm test
```
