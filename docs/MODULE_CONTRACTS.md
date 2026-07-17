# Module Contracts

[简体中文](MODULE_CONTRACTS.md) | [English](MODULE_CONTRACTS.en.md)

本文定义 Agent Hub 的模块约束。目标不是把所有能力都拆成微服务，而是先让每个模块拥有清晰边界、稳定插槽和可演进规范。

## 1. 模块定义

一个模块必须满足以下条件：

- 有明确领域对象，例如 Agent、Skill、Spec、Workflow、Tool、Policy、Trace、Worker。
- 有独立 schema / contract，用于校验外部输入和持久化数据。
- 有稳定 service 或 store 入口，调用方不直接读写内部文件结构。
- 有独立测试覆盖核心行为。
- 能说明它依赖谁、被谁依赖、哪些依赖是可替换插槽。

仅有目录、工具函数或 UI 页面不算独立模块。

## 2. 标准模块形态

每个核心模块应尽量遵循以下结构：

```text
<module>Schema.js / <module>Contract.ts
  ↓
<module>Store.js
  ↓
<module>Service.js
  ↓
HTTP API / CLI / UI
```

允许某些纯 Registry 模块没有 Service 层，例如 Skill Registry；但它仍然必须有 Schema 和 Store。

## 3. 稳定插槽

模块对外只能暴露稳定插槽，不暴露内部实现。

| 插槽 | 职责 | 示例 |
|---|---|---|
| Schema / Contract | 定义输入、输出、状态、版本和兼容性 | `specSchema.js`, `workflowNodeContract.ts` |
| Store | 持久化和读取领域对象 | `specStore.js`, `workflowRunStore.js` |
| Service | 编排领域行为和副作用 | `workflowService.js`, `toolService.js` |
| Adapter | 替换外部系统或运行环境 | Runtime Adapter, Store Adapter, Tool Adapter |
| Policy Hook | 进入执行前的治理判断 | tool call、agent run、workflow run |
| Trace Hook | 记录可调试、可评估、可审计的证据 | run trace、audit event |

插槽可以新增，但不能绕过已有插槽直接访问内部状态。

## 4. 边界规则

### 4.1 依赖方向

推荐依赖方向：

```text
Schema / Contract
  → Store
    → Service
      → Runtime Adapter
        → Workflow / Orchestrator
          → HTTP API / UI
```

禁止反向依赖：

- Schema 不 import Store、Service、API 或 UI。
- Store 不 import HTTP API、UI、Runtime Adapter。
- Policy 只做决策，不执行副作用。
- UI 不直接读写 `state/*` 文件。
- Workflow Runtime 不直接绕过 Tool Hub 调 MCP 或外部服务。

### 4.2 数据边界

模块之间传递领域对象或 DTO，不传递内部文件路径作为业务协议。

允许：

```js
await readSpec('checkout-flow', 1);
await startWorkflowRun('delivery-flow', input, { specId: 'checkout-flow', specVersion: 1 });
```

不允许：

```js
await readFile('state/specs/checkout-flow/v1.json');
```

### 4.3 执行边界

有副作用的模块必须经过治理插槽：

- 外部网络：Tool Hub / Runtime Adapter / Policy。
- 文件系统写入：Sandbox / Worktree lease。
- Git 写入：Delivery Service / Approval。
- 模型调用：Agent Runtime / Provider policy。
- 子流程调用：Workflow Runtime / Subworkflow contract。

## 5. 版本与兼容性

核心资产必须版本化：

- Agent
- Skill
- Spec
- Workflow
- Tool
- Policy

发布后的版本视为不可变。新增 draft version 才能修改。

兼容性规则：

- Workflow 发布时必须 pin Agent、Tool、Subworkflow 的具体版本。
- Workflow Run 绑定 Spec 时必须保存 `specId`、`specVersion` 和 `specSnapshot`。
- 运行时使用 snapshot，不依赖最新 draft。
- Breaking schema change 必须生成 compatibility report 或显式标记。

## 6. Spec-driven 约束

Spec Hub 是独立模块，不内嵌到 Workflow。

```text
Spec Hub
  → Workflow Run binding
    → Node Run / Trace / Artifact evidence
      → Compliance Report
```

规则：

- 只有 Published Spec 可绑定 Workflow Run。
- Workflow Run 必须保存 Spec snapshot，避免后续 Spec 修改影响历史 run。
- Acceptance Criteria 后续应绑定 evidence，例如 test、trace、review 或 manual approval。
- Workflow Template 可以推荐 Spec，但不能替代 Spec。

## 7. Governance 约束

治理能力不应散落在各模块内部，而应通过统一 hook 注入：

| 治理点 | 必须接入 |
|---|---|
| Policy | agent.run, tool.call, workflow.run, git/write/deploy 等高风险 action |
| Sandbox | 文件系统、网络、worktree、secret |
| Approval | 高风险、越权、外部写入、发布动作 |
| Audit | 谁触发、何时触发、基于什么 policy、结果是什么 |
| Trace | 输入摘要、输出摘要、错误、耗时、token/cost、evidence |

模块可以提出治理请求，但不应自行绕过或替代统一决策。

## 8. 测试约束

每个模块至少需要：

- Schema validation test。
- Store lifecycle test。
- Service behavior test，如果模块有 Service 层。
- Boundary test，例如拒绝 draft Spec 绑定 Workflow Run。
- Regression test，覆盖历史兼容行为。

测试应优先使用临时目录，不依赖真实 `state/`。

## 9. 新模块准入清单

新增模块前必须回答：

1. 模块的领域对象是什么？
2. 它是否需要版本生命周期？
3. 它的稳定插槽是什么？
4. 它依赖哪些模块？
5. 谁可以调用它？
6. 它有哪些副作用？
7. 它如何接入 Policy / Sandbox / Approval / Trace？
8. 它如何测试？
9. 它未来是否可被独立服务化？

如果回答不清，先不要新增模块；优先把它作为现有模块的 capability 或 adapter。

## 10. 当前模块边界建议

| 模块 | 边界状态 | 下一步 |
|---|---|---|
| Agent Registry | 清晰 | 继续补兼容性与 provider policy |
| Skill Registry | 清晰 | 明确 Skill output contract 与 agent binding |
| Spec Hub | 初步清晰 | 增加 evidence 与 compliance report |
| Workflow Registry | 清晰 | 强化模板与 workflow contract |
| Workflow Runtime | 仍偏聚合 | 抽象 Queue / Worker / Governance hooks |
| Tool Hub | 较清晰 | 扩展 MCP Adapter 与 per-tool policy |
| Policy Engine | 清晰 | 增加 role / admin / approval source |
| Trace Store | 清晰 | 增加 eval rubric 与 regression gate |
| Work Item Orchestrator | 聚合层 | 避免继续膨胀，能力下沉到模块 |

## 11. 架构原则

- 模块先独立，组合后强大。
- Workflow 负责编排，不负责定义所有业务语义。
- Spec 负责目标和验收，不负责执行。
- Policy 负责决策，不负责执行。
- Runtime 负责执行，不负责制定规则。
- Trace 负责证据，不负责改变结果。
- UI 负责呈现和操作，不负责绕过领域服务。
