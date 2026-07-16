# Technical Design

[简体中文](TECHNICAL_DESIGN.md) | [English](TECHNICAL_DESIGN.en.md)

## Architecture

下图是主线目标结构。当前 HTTP Tool 已接入 Policy；Agent、Feature Delivery 与所有 Workflow Node 的统一 Kernel/Sandbox 强制执行仍在演进中。

```mermaid
flowchart TD
  UI["Web UI / CLI"] --> API["HTTP API"]
  API --> WI["Work Item Orchestrator"]
  API --> WF["Workflow Runtime"]
  WF -. governance target .-> K["Execution Kernel"]
  K --> P["Policy Engine"]
  K --> S["Sandbox Resolver"]
  WF --> A["Agent Runtime Adapters"]
  WF --> T["Tool Runtime"]
  WF --> AP["Approval Gate"]
  A --> TR["Trace + Audit"]
  T --> TR
  WI --> D["Delivery Service"]
  WI --> ST["Local JSON State"]
  WF --> ST
```

## Core objects

公共 TypeScript 契约位于 `src/types/`。运行时 Schema 负责外部输入校验，TypeScript 类型负责开发期约束；两者必须保持相同的字段语义。

Workflow 使用 `contractVersion: 1`。`workflowNodeContract` 提供节点端口、边基数、风险类别和跨节点引用检查，`GET /api/workflow-node-contracts` 向画布暴露同一份运行时契约。

`workflowAssetContract` 在发布时解析固定版本的 Agent、Tool 和 Subworkflow，并根据真实 input Schema 检查必填映射。新增 Contract 实现使用 TypeScript；`prestart` 和 `pretest` 会先执行构建，Node 加载 `dist/` 中的生成文件。

- Work Item：任务身份、来源、repo、状态、worktree 和 artifacts。
- Agent：prompt、schema、provider、skills、tools、permissions 和 limits。
- Skill：可复用方法与输出契约，不直接获得运行权限。
- Workflow：版本化 DAG，把 Agent、Tool、条件、并行、审批和交付连接起来。
- Tool：确定性外部能力，密钥通过环境变量引用。
- Policy：对 action、tool、sandbox 和 approval 作确定性决策。
- Trace：调试与评估数据；Audit 表达责任链。

## Execution paths

Agent Run：`validate input → resolve adapter → execute → validate output → persist run → append trace`。

Workflow Run 当前为：`resolve node → map input → execute node → persist output → choose edge → finish/pause`。Tool Node 会执行 Policy 检查；全节点统一 Policy/Sandbox 是目标主线。

Work Item：`intake → plan gate → isolated implementation → validation/review → approval → delivery`。这是当前执行链；新能力优先通过 Workflow Agent Nodes 组合。

## Persistence

当前使用 `state/*` JSON 文件，并以原子 rename 和按 ID 串行写保护更新。适合单机和原型，不适合多实例并发。服务化时应替换 Store 实现，而不是修改领域 Service。

## Security boundaries

- 默认只监听 loopback；远程监听需要显式开启和 Bearer token。
- Sandbox Resolver 已能拒绝权限升级；其对全部 Agent Run 的强制接线仍需继续完成。
- 外部 source 和 tool output 应标记为 untrusted context。
- Provider endpoint、Tool host 和 secret env 必须显式声明。
- Git 写入、外部写操作和高风险 action 应进入 Approval。

## Extension points

- Runtime Adapter：新增模型或执行环境。
- Source Adapter：接入 GitHub、Linear、Notion、手工输入或内部系统。
- Tool Adapter：HTTP、MCP 或本地确定性工具。
- Store Adapter：从本地 JSON 迁移到数据库或对象存储。
- Policy Evaluator：增加组织级角色、风险和审批规则。

更完整的治理主线见 [Governed Agent OS](governed-agent-os-mainline-design.md)。
