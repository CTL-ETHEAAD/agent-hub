# Agent Hub 演进更新说明

[简体中文](UPDATE_NOTES.md) | [English](UPDATE_NOTES.en.md)

## 概览

这轮演进将 Agent Hub 从本地 Agent 工作台推进到 Agent OS 主线骨架。核心变化是：Workflow 不再只是进程内函数调用，而是逐步具备版本化契约、可恢复 Node Run、多 Worker 执行、资源调度、Sandbox / Worktree 边界、动态委派和治理快照。

当前状态可定义为：

> Agent OS skeleton complete.

它已经具备生产化深化所需的主要控制面和执行面对象，但仍需要继续完成 UI 产品化、真实强隔离、数据库 Store、生产 Queue、RBAC 和 Eval Gate。

## 分支与阶段

建议按以下顺序合并：

1. `feature/schema-compatibility-v1`
2. `feature/node-run-persistence-v1`
3. `feature/local-worker-runtime-v1`
4. `feature/worker-node-handlers-v1`
5. `feature/scheduler-resource-policy-v1`
6. `feature/worktree-sandbox-boundary-v1`
7. `feature/delegation-governance-v1`

## Phase 1：积木契约标准化

相关分支：

- `feature/node-contract-v1`
- `feature/schema-compatibility-v1`

主要更新：

- 新增 Node Contract v1。
- 增加 Workflow 静态引用校验。
- 增加 Contract Catalog API。
- 发布 Workflow 时解析并锁定 Agent、Tool 和子 Workflow 版本。
- Agent / Tool 发布新版本时生成 Schema compatibility report。
- 检测破坏性 Schema 变化，包括 required、property、type、enum 和 additionalProperties。

价值：

- Workflow 积木连接更安全。
- 未指定版本的资产不会因“最新版本”变化导致运行漂移。
- Agent / Tool 升级时可以识别破坏性契约变化。

## Phase 2：Node Run 持久化

相关分支：

- `feature/node-run-persistence-v1`

主要更新：

- 新增独立 Node Run 数据模型。
- 新增 Node Run Store 和 Service。
- 支持 `queued`、`claimed`、`running`、`waiting`、`succeeded`、`failed`、`cancelled`、`interrupted` 状态。
- 支持 attempt、idempotency key、输入快照、输出引用和错误快照。
- Workflow Runtime 在节点开始、输入、等待、成功、失败和取消时同步写入 Node Run。
- 新增只读 API：
  - `GET /api/workflow-runs/:id/node-runs`
  - `GET /api/node-runs/:id`

价值：

- Workflow 节点从进程内调用升级为可恢复任务。
- 后续 Scheduler / Worker 可以基于 Node Run 接管执行。
- Run Detail 和节点时间线有了稳定数据来源。

## Phase 3：本地多进程 Worker

相关分支：

- `feature/local-worker-runtime-v1`
- `feature/worker-node-handlers-v1`

主要更新：

- 新增 Worker Registry。
- 支持 worker 心跳、能力标签、并发槽位和 active Node Run。
- 实现 Node Run claim / lease / renew / complete 协议。
- 实现过期 lease 回收和 stale worker 标记。
- 新增本地 CLI：
  - `agent-hub worker`
  - `agent-hub scheduler`
- Worker 支持可插拔 handler。
- 内置 start、condition、end、agent 和 tool 节点 handler。
- Agent 节点复用 Agent Service。
- Tool 节点复用 Tool Service 与 Policy 检查。
- 新增 Worker 查询 API：
  - `GET /api/workers`
  - `GET /api/workers/:id`

价值：

- 执行能力开始从 Server 进程迁出。
- 本地可以运行多个 Worker 消费不同 Node Run。
- Agent / Tool 节点已具备 worker-native 执行基础。

## Phase 4：资源调度与真实并行基础

相关分支：

- `feature/scheduler-resource-policy-v1`

主要更新：

- Node Run 新增 scheduling 元数据。
- 支持 priority。
- 支持 requiredCapabilities。
- Worker claim 时根据以下条件选择 queued Node Run：
  - worker capability tags
  - active slots / concurrency slots
  - Node Run priority
- 修复 worker 重新注册时清空 activeNodeRunIds 的问题。

价值：

- Worker 不会抢占自己无法执行的任务。
- 已满载 Worker 不会继续 claim 新任务。
- 高优先级任务可以优先被调度。
- 为 Parallel / Join 的真实并行调度打下基础。

## Phase 5：Worktree / Sandbox 边界

相关分支：

- `feature/worktree-sandbox-boundary-v1`

主要更新：

- 新增 Worktree Lease Service。
- 支持 worktree 独占锁、释放和过期恢复。
- 新增稳定 worktree key 生成。
- 新增 sandbox runtime resolver。
- Worker 执行 Node Run 前解析 sandbox snapshot。
- isolated / workspace-write / gitWrite 的代码型节点会申请 worktree lease。
- Worker handler 可以读取 sandboxSnapshot。

价值：

- 多个实现类 Agent 不会写入同一工作目录。
- Sandbox 决策开始进入 Worker 执行边界。
- 后续可以继续接入真实 worktree 创建、网络限制和 secret lease。

## Phase 6：动态 Supervisor 与 Sub-agent

相关分支：

- `feature/delegation-governance-v1`

主要更新：

- Agent Run 新增委派元数据：
  - `rootRunId`
  - `parentRunId`
  - `depth`
  - `delegationReason`
- 新增受治理的 Agent delegation service。
- 委派时校验：
  - maxDepth
  - 每个 parent run 的 child 数量
  - allowed agent allowlist
- 新增 Run Tree 查询。
- 新增树级取消入口。
- 新增 API：
  - `POST /api/agent-runs/:id/delegate`
  - `GET /api/agent-runs/:id/tree`
  - `POST /api/agent-runs/:id/cancel-tree`

价值：

- 动态 Sub-agent 不再是任意扩权行为。
- 每次委派都有 parent、root、depth 和 reason。
- Run Tree 可以追踪动态委派结构。

## Phase 7：分布式治理基础

相关分支：

- `feature/delegation-governance-v1`

主要更新：

- Worker Registry 新增 capability attestation：
  - subject
  - issuer
  - issuedAt / expiresAt
  - capabilityTags
  - signature
  - verified
- 新增 Governance Snapshot Service。
- Governance Snapshot 汇总：
  - Agent Run 状态
  - Workflow Run 状态
  - Worker attestation 状态
  - Trace 类型统计
  - 基础 regression gate 结果
- 新增 Admin API：
  - `GET /api/admin/governance-snapshot`

价值：

- Worker 身份与能力具备可验证字段。
- 管理面可以查看运行、worker、trace 和 gate 的整体状态。
- 为后续数据库 Store、Queue/Event Bus、RBAC、审计导出和生产部署预留替换点。

## 当前能力总结

已具备：

- Versioned Agent / Skill / Tool / Workflow / Policy。
- Node Contract v1。
- Schema compatibility report。
- Workflow asset version pinning。
- Node Run 持久化与状态机。
- Worker Registry、lease 和本地 Worker Runtime。
- Agent / Tool Worker Handler。
- Worker capability / priority / slot 调度。
- Sandbox snapshot。
- Worktree Lease。
- Delegation / Run Tree。
- Worker attestation。
- Governance Snapshot。

仍需深化：

- Workflow Runtime 全量 queue-driven。
- Parallel / Join 完整 fail-fast、wait-all、partial-success 策略。
- 真实 Worktree 创建、清理和保留。
- 网络隔离与 secret lease 的强执行。
- UI 展示 Run Tree、Worker、Governance 和 Parallel Timeline。
- Store Adapter、SQLite / Postgres 和生产 Queue。
- RBAC、Approval Center 和 Audit Export。
- Trace-based Eval、Rubric、AutoRater 和 Release Gate。

## 建议下一步

1. 产品化 Run Detail 和 Worker 页面。
2. 将 Workflow Runtime 全量切到 Node Run Queue。
3. 强化 Worktree Manager 与 Sandbox enforcement。
4. 增加 Approval Center 与 Governance Dashboard。
5. 抽象 Store Adapter 并落 SQLite / Postgres。
6. 接入 Trace-based Eval 和 Regression Gate。
