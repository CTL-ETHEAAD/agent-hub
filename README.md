# Agent Hub

[简体中文](README.md) | [English](README.en.md)

Agent Hub 是一个 local-first、可治理的 Agent 工作台。它用于注册 Agent 与 Skill，通过可视化 Workflow 组合能力，并用 Tool、Policy、Sandbox、Approval 和 Trace 控制执行过程。

```text
Work Item → Intake → Plan → Approval → Implement → Validate → Review → Delivery
```

> 当前为 experimental 版本，会执行模型、代码与外部工具。启用写权限或网络前请阅读 [SECURITY.md](SECURITY.md)。

## Quick Start

要求：Node.js 20+。Claude Code 仅在选择 `claude-code` provider 时需要。

```bash
git clone <your-agent-hub-repository>
cd agent-hub
npm install
npm test
npm start
```

打开 [http://127.0.0.1:4317](http://127.0.0.1:4317)，点击右上角 **Initialize Assets**。这会幂等地发布内置 Agents、Skills 和 Workflows，不会覆盖已有版本。

推荐先验证：

1. 打开 Agents，确认内置 Agent Pack 已出现。
2. 打开 Workflows，从模板创建 `work-item-planning`。
3. 配置一个模型 provider。
4. 先运行只读的 Requirement Analyst 或 Review Pipeline。
5. 配置 repo profile 后，再启用 Implementation 与 Delivery。

## 接入模型

内置支持：

- `claude-code`：使用本机 Claude Code CLI。
- `openai-compatible`：适用于 OpenAI Chat Completions 兼容服务。
- 自定义 provider：通过 Runtime Adapter 注册。

完整配置、环境变量和示例见 [模型接入指南](docs/MODEL_PROVIDERS.md)。

## 配置代码仓库

复制 `repos/demo` 中的示例文件，创建自己的 `repos/<repo>/repo.config.json` 和 repo profile。不要提交本机绝对路径、私有源码或组织内部说明。

## 文档

- [文档索引](docs/README.md)
- [模型接入指南](docs/MODEL_PROVIDERS.md)
- [技术设计](docs/TECHNICAL_DESIGN.md)
- [独立模块说明](docs/MODULES.md)
- [Agent Hub 演进计划](docs/EVOLUTION_PLAN.md)
- [Governed Agent OS 主线设计](docs/governed-agent-os-mainline-design.md)
- [安全说明](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)

## 常用命令

```bash
npm start
npm test
npm run build
npm run typecheck
npm run check
npm run hub -- list
npm run hub -- show demo-task-1
```

运行数据保存在 `state/`，该目录默认不进入 Git。

## 当前状态

- Agent、Skill、Workflow、Tool 和 Policy 均支持版本生命周期。
- Workflow 支持 Agent、Tool、Condition、Parallel、Join、Subworkflow、Approval 和 Feature 节点。
- HTTP Tool、Claude Code Runtime、OpenAI-compatible Runtime 可用。
- MCP 注册模型已有，完整 MCP Runtime Adapter 尚未完成。
- 核心领域契约已在 `src/types/` 中提供 TypeScript 类型定义。
- 项目采用 Apache-2.0 License。
