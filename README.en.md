# Agent Hub

[简体中文](README.md) | [English](README.en.md)

Agent Hub is a local-first, governable workspace for registering Agents and Skills, composing them into visual Workflows, and controlling execution through Tools, Policies, Sandboxes, Approvals, and Traces.

```text
Work Item → Intake → Plan → Approval → Implement → Validate → Review → Delivery
```

> Agent Hub is experimental and can execute models, code, and external tools. Read [SECURITY.md](SECURITY.md) before enabling filesystem writes or network access.

## Quick Start

Requirement: Node.js 20+. Claude Code is required only when using the `claude-code` provider.

```bash
git clone <your-agent-hub-repository>
cd agent-hub
npm install
npm test
npm start
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317) and click **Initialize Assets** in the upper-right corner. Initialization idempotently publishes the built-in Agents, Skills, and Workflows without overwriting existing versions.

Recommended first validation:

1. Open Agents and confirm that the built-in Agent Pack is available.
2. Open Workflows and create `work-item-planning` from its template.
3. Configure a model provider.
4. Run the read-only Requirement Analyst or Review Pipeline first.
5. Configure a repo profile before enabling Implementation and Delivery.

## Connect a Model

Built-in options:

- `claude-code`: uses the local Claude Code CLI.
- `openai-compatible`: works with OpenAI Chat Completions-compatible services.
- Custom provider: register a Runtime Adapter.

See the [Model Provider Guide](docs/MODEL_PROVIDERS.en.md) for configuration, environment variables, and examples.

## Configure a Repository

Copy the examples under `repos/demo` and create `repos/<repo>/repo.config.json` plus a repo profile. Do not commit local absolute paths, private source code, or internal organization documentation.

## Documentation

- [Documentation index](docs/README.en.md)
- [Model Provider Guide](docs/MODEL_PROVIDERS.en.md)
- [Technical Design](docs/TECHNICAL_DESIGN.en.md)
- [Independent Modules](docs/MODULES.en.md)
- [Agent Hub Evolution Plan](docs/EVOLUTION_PLAN.en.md)
- [Governed Agent OS mainline design](docs/governed-agent-os-mainline-design.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Common Commands

```bash
npm start
npm test
npm run build
npm run typecheck
npm run check
npm run hub -- list
npm run hub -- show demo-task-1
```

Runtime data is stored under `state/`, which is excluded from Git by default.

## Current Status

- Agents, Skills, Workflows, Tools, and Policies have versioned lifecycles.
- Workflows support Agent, Tool, Condition, Parallel, Join, Subworkflow, Approval, and Feature nodes.
- HTTP Tool, Claude Code Runtime, and OpenAI-compatible Runtime are available.
- MCP registration exists; the complete MCP Runtime Adapter is not yet implemented.
- Core domain contracts are available as TypeScript definitions under `src/types/`.
- The project is licensed under Apache-2.0.
