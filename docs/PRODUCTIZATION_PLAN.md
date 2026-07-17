# Agent Hub 产品化与生产化深化计划

## 1. 背景

Agent Hub 当前已经完成 Agent OS 主线骨架：

- 积木契约、Schema 兼容性和版本锁定。
- Node Run 持久化、Worker claim/lease 和本地多进程执行基础。
- Agent/Tool Worker Handler、资源匹配、并发槽和优先级。
- Sandbox snapshot、Worktree Lease、动态 delegation 和 Run Tree。
- Worker capability attestation、governance snapshot 和基础 regression gate。

下一阶段目标不再是继续扩展概念，而是把系统打磨成可稳定安装、可观察、可治理、可扩展、可部署的产品。

## 2. 总体目标

将 Agent Hub 从架构完整的本地原型，演进为可用于团队开发流程的生产级 Agent Operating System。

核心目标：

- 用户能稳定创建、运行、观察和恢复 Workflow。
- Worker、Tool、Agent、Policy、Sandbox 和 Approval 均可治理。
- 代码修改、网络访问和 secret 使用有真实执行边界。
- 运行数据可审计、可评估、可回放。
- 存储、队列、Worker 和 Connector 具备生产替换点。

## 3. Phase A：运行闭环产品化（P0）

目标：让用户能稳定创建、运行、观察一个完整 Workflow。

主要工作：

1. Workflow Runtime 全量接入 Node Run Queue
   - Workflow 节点推进从进程内循环迁移为 queue-driven。
   - Server 只负责编排状态，不直接执行 Agent/Tool 子进程。
   - Node Run 成为所有节点执行的事实来源。

2. Parallel / Join 完整策略
   - 支持 `fail-fast`。
   - 支持 `wait-all`。
   - 支持 `partial-success`。
   - 支持 branch timeout、branch cancellation 和 join result aggregation。

3. Run Detail 页面产品化
   - 展示 Workflow Run timeline。
   - 展示 Node Run 状态、attempt、lease、worker 和错误。
   - 展示 Agent Run / Tool Run 子详情。
   - 展示 sandbox snapshot 和 policy decision。

4. Worker 管理页面
   - 展示 online / stale / offline workers。
   - 展示 capability tags、active slots、attestation 状态。
   - 展示 current node runs 和最近 heartbeat。

完成标准：

- 用户能在 UI 中看到 Workflow 从 queued 到 succeeded / failed 的完整过程。
- Worker 失联、失败、重试都有明确状态。
- Parallel workflow 行为确定且可测试。

## 4. Phase B：Sandbox / Worktree 强执行（P0）

目标：把隔离决策升级为真实执行隔离。

主要工作：

1. Worktree Manager
   - fresh worktree 创建。
   - per-run / per-node 策略。
   - lock / release / cleanup。
   - failed run 保留策略。
   - stale worktree recovery。

2. Runtime Adapter 接入 sandbox snapshot
   - Agent runtime 启动前必须使用 resolved sandbox。
   - 传入受控 cwd、filesystem scope、network mode、env 和 git write permission。
   - Runtime adapter 只执行已解析权限，不自行决定业务权限。

3. Network enforcement
   - HTTP Tool、model provider、MCP server 统一走 allowlist。
   - 未授权网络请求在发起前失败。
   - 高风险外部写操作进入 approval。

4. Secret lease
   - Secret 不进入 prompt。
   - Secret 不持久化到 run、trace、audit 或 UI。
   - Secret 只在获准调用期间短暂注入。

完成标准：

- 两个 implementation agent 不会写同一个目录。
- 未授权网络请求在发起前失败。
- Secret 不出现在 trace、audit、error 和 UI。

## 5. Phase C：治理与企业控制面（P1）

目标：让 Agent Hub 具备可管理、可审计、可控权的平台能力。

主要工作：

1. Admin API
   - Worker management。
   - Policy management。
   - Approval management。
   - Audit export。
   - Quota / budget overview。

2. RBAC / Role-based Tool Access
   - `owner`。
   - `admin`。
   - `workflow_editor`。
   - `operator`。
   - `viewer`。

3. Human Approval Center
   - pending approvals。
   - high-risk tool calls。
   - git write。
   - external publish / deploy。
   - policy-triggered approvals。

4. Governance Dashboard
   - policy decisions。
   - denied actions。
   - worker attestation。
   - cost / usage。
   - regression gate result。

完成标准：

- 高风险动作必须可审批、可追踪。
- 每次工具调用和 Agent 委派都能回答：谁允许的、基于什么 policy、产生了什么结果。
- 管理员能导出审计记录。

## 6. Phase D：存储与分布式运行（P1）

目标：从 local JSON prototype 走向 production deployment。

主要工作：

1. Store Adapter 层
   - Agent Store。
   - Workflow Store。
   - Run Store。
   - Node Run Store。
   - Worker Store。
   - Trace Store。

2. 数据库实现
   - SQLite：适合 local / single-user。
   - Postgres：适合 team / production。

3. Queue / Event Bus
   - Local queue for dev。
   - Redis / Postgres queue for team。
   - NATS / Kafka for larger deployment。

4. Remote Worker Identity
   - Worker 注册身份。
   - Capability attestation。
   - Heartbeat。
   - Signed claim / completion。

完成标准：

- Server 多实例不会破坏 run 状态。
- Worker 可运行在远程机器。
- Node Run claim 具备租约和幂等保护。

## 7. Phase E：Eval / Regression Gate（P1）

目标：让 Agent Hub 可以持续改进，而不是每次靠手工试跑。

主要工作：

1. Trace-based Eval
   - 从生产 traces 生成 eval cases。
   - 保存 input、expected behavior、policy decision、final output 和 failure mode。

2. Rubric 系统
   - correctness。
   - safety。
   - tool discipline。
   - policy compliance。
   - cost / latency。

3. AutoRater
   - 对 Agent output / Workflow result 自动评分。
   - 支持人工复核和样本固化。

4. Release Gate
   - Schema compatibility。
   - Static validation。
   - Regression eval。
   - Policy check。

完成标准：

- 修改 Agent prompt 或 Tool schema 后，能自动知道是否破坏旧流程。
- 关键 Workflow 发布前必须通过 gate。
- 失败结果可回放、可定位。

## 8. Phase F：开放生态与开发者体验（P2）

目标：让外部开发者可以把 Agent Hub 当平台扩展。

主要工作：

1. Plugin / Connector SDK
   - Tool adapter。
   - Model adapter。
   - Source adapter。
   - Store adapter。
   - Worker handler。

2. MCP / A2A 分层
   - MCP = tool capability。
   - A2A = agent communication / delegation。
   - Policy = permission layer。
   - Audit = accountability layer。

3. Template Marketplace
   - Code review。
   - Requirement analysis。
   - Implementation pipeline。
   - Security review。
   - Release automation。

4. Developer Guide
   - Create an Agent。
   - Add a model provider。
   - Add a Tool。
   - Create a Workflow。
   - Run Worker。
   - Deploy production。

完成标准：

- 新开发者 15 分钟内能启动、初始化、跑一个 Workflow。
- 外部开发者能独立新增 provider、tool 和 worker handler。
- 模板可复用、可版本化、可导入导出。

## 9. 推荐执行顺序

1. Phase A：Workflow Runtime queue-driven + Run UI。
2. Phase B：Worktree / Sandbox 强执行。
3. Phase C：Approval / Governance Dashboard。
4. Phase D：Store Adapter + SQLite / Postgres。
5. Phase E：Trace Eval / Regression Gate。
6. Phase F：SDK / Template / Ecosystem。

## 10. 近期建议里程碑

### Milestone 1：Runnable Product Loop

- Queue-driven Workflow Runtime。
- Run Detail 页面。
- Worker 页面。
- Parallel / Join 策略第一版。

### Milestone 2：Safe Code Execution

- Worktree Manager。
- Runtime sandbox enforcement。
- Network allowlist enforcement。
- Secret lease。

### Milestone 3：Governed Team Usage

- Approval Center。
- Governance Dashboard。
- RBAC。
- Audit export。

### Milestone 4：Production Runtime

- Store Adapter。
- SQLite / Postgres。
- Queue backend。
- Remote Worker identity。

### Milestone 5：Continuous Quality

- Trace eval。
- Rubric。
- AutoRater。
- Regression gate。

## 11. 当前判断

Agent Hub 当前可以定位为 `Agent OS skeleton complete`。

完成 Phase A 和 Phase B 后，可以定位为 `Agent Hub alpha`。

完成 Phase C 和 Phase D 后，可以定位为 `Agent Hub team beta`。

完成 Phase E 和 Phase F 后，可以进入稳定开源或商业化准备阶段。
