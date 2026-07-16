# Independent Modules

[简体中文](MODULES.md) | [English](MODULES.en.md)

Agent Hub currently deploys as a single process, but most modules can already be tested or replaced independently and extracted into services later.

| Module | Entry points | Independently usable | Main dependencies |
|---|---|---:|---|
| Agent Registry | `agentSchema.js`, `agentStore.js` | Yes | filesystem |
| Agent Runtime | `agentService.js`, `agentRuntime.js` | Yes | Agent Store, Runtime Adapter, Trace |
| Skill Registry | `skillSchema.js`, `skillStore.js` | Yes | filesystem |
| Workflow Registry | `workflowSchema.js`, `workflowStore.js` | Yes | filesystem |
| Workflow Runtime | `workflowService.js` | Mostly | Agent, Tool, Workflow Run Store; governance is not yet uniform across all nodes |
| Tool Hub | `toolSchema.js`, `toolStore.js`, `toolService.js` | Yes | Policy, fetch, environment secrets |
| Policy Engine | `policy/*` | Yes | Policy Store |
| Sandbox Resolver | `sandbox/sandboxPolicy.js` | Yes | Policy/Agent/Workflow declarations |
| Trace Store | `trace/traceStore.js` | Yes | filesystem |
| Work Item Orchestrator | `orchestrator.js` | No; aggregation layer | repository, runtime, state, review, delivery |
| Delivery Service | `deliveryService.js` | Yes | Git/GitHub CLI, approved Work Item |
| Web/API | `server.js`, `public/*` | No; composition entry point | all application services |

## Dependency Direction

```text
Schema / Store
  → Domain Service
    → Runtime Adapter
      → Workflow / Orchestrator
        → HTTP API / UI
```

Lower-level modules must not import the UI or server. Policy makes decisions but does not execute side effects. Runtime Adapters execute resolved permissions and do not define governance rules.

## Extraction Recommendations

Recommended order:

1. Tool Runtime / MCP Gateway: the clearest network and secret boundary.
2. Trace/Eval Service: high write volume and independently scalable.
3. Policy/Approval Service: organization governance needs a unified decision source.
4. Agent Runtime Workers: require queues, leases, heartbeats, and sandboxes.

Registry and Store modules can remain embedded initially. Keep the Work Item Orchestrator as an application-layer coordinator.

## Module Tests

Each module has corresponding tests under `test/*.test.js`. Run the complete suite with:

```bash
npm test
```
