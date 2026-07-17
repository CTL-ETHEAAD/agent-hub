# Module Contracts

[简体中文](MODULE_CONTRACTS.md) | [English](MODULE_CONTRACTS.en.md)

This document defines the module constraints for Agent Hub. The goal is not to turn every capability into a microservice immediately, but to give each module clear boundaries, stable slots, and evolvable contracts.

## 1. What Counts as a Module

A module must have:

- A clear domain object, such as Agent, Skill, Spec, Workflow, Tool, Policy, Trace, or Worker.
- An independent schema or contract for validating external input and persisted data.
- A stable service or store entry point, so callers do not read or write internal files directly.
- Independent tests for core behavior.
- Clear dependency direction, consumers, and replaceable slots.

A folder, utility function, or UI page alone is not an independent module.

## 2. Standard Module Shape

Core modules should follow this structure when possible:

```text
<module>Schema.js / <module>Contract.ts
  ↓
<module>Store.js
  ↓
<module>Service.js
  ↓
HTTP API / CLI / UI
```

Some pure Registry modules may not need a Service layer, such as the Skill Registry, but they still need Schema and Store boundaries.

## 3. Stable Slots

Modules expose stable slots, not internal implementation details.

| Slot | Responsibility | Examples |
|---|---|---|
| Schema / Contract | Inputs, outputs, states, versions, and compatibility | `specSchema.js`, `workflowNodeContract.ts` |
| Store | Persist and read domain objects | `specStore.js`, `workflowRunStore.js` |
| Service | Coordinate domain behavior and side effects | `workflowService.js`, `toolService.js` |
| Adapter | Replace external systems or runtimes | Runtime Adapter, Store Adapter, Tool Adapter |
| Policy Hook | Governance decision before execution | tool call, agent run, workflow run |
| Trace Hook | Debuggable, evaluable, auditable evidence | run trace, audit event |

New slots may be added, but callers must not bypass existing slots to access internal state.

## 4. Boundary Rules

### 4.1 Dependency Direction

Recommended dependency direction:

```text
Schema / Contract
  → Store
    → Service
      → Runtime Adapter
        → Workflow / Orchestrator
          → HTTP API / UI
```

Forbidden reverse dependencies:

- Schema must not import Store, Service, API, or UI.
- Store must not import HTTP API, UI, or Runtime Adapter.
- Policy makes decisions only; it does not execute side effects.
- UI must not directly read or write `state/*` files.
- Workflow Runtime must not call MCP or external services directly outside Tool Hub.

### 4.2 Data Boundary

Modules pass domain objects or DTOs, not internal file paths as business protocols.

Allowed:

```js
await readSpec('checkout-flow', 1);
await startWorkflowRun('delivery-flow', input, { specId: 'checkout-flow', specVersion: 1 });
```

Not allowed:

```js
await readFile('state/specs/checkout-flow/v1.json');
```

### 4.3 Execution Boundary

Side-effecting modules must pass through governance slots:

- External network: Tool Hub / Runtime Adapter / Policy.
- Filesystem writes: Sandbox / Worktree lease.
- Git writes: Delivery Service / Approval.
- Model calls: Agent Runtime / Provider policy.
- Child workflow calls: Workflow Runtime / Subworkflow contract.

## 5. Versioning and Compatibility

Core assets must be versioned:

- Agent
- Skill
- Spec
- Workflow
- Tool
- Policy

Published versions are immutable. Changes require a new draft version.

Compatibility rules:

- Workflow publication must pin concrete Agent, Tool, and Subworkflow versions.
- Workflow Runs bound to Specs must store `specId`, `specVersion`, and `specSnapshot`.
- Runtime execution uses snapshots, not latest drafts.
- Breaking schema changes must produce a compatibility report or explicit marker.

## 6. Spec-driven Constraints

Spec Hub is an independent module and should not be embedded into Workflow.

```text
Spec Hub
  → Workflow Run binding
    → Node Run / Trace / Artifact evidence
      → Compliance Report
```

Rules:

- Only Published Specs can be bound to Workflow Runs.
- Workflow Runs must store Spec snapshots so historical runs are not affected by later Spec changes.
- Acceptance Criteria should later bind evidence such as test, trace, review, or manual approval.
- Workflow Templates may recommend Specs, but they do not replace Specs.

## 7. Governance Constraints

Governance should not be scattered inside every module. It should be injected through unified hooks.

| Governance point | Required coverage |
|---|---|
| Policy | agent.run, tool.call, workflow.run, git/write/deploy, and other high-risk actions |
| Sandbox | filesystem, network, worktree, secret |
| Approval | high risk, privilege escalation, external writes, release actions |
| Audit | who triggered it, when, which policy applied, and the result |
| Trace | input summary, output summary, errors, duration, token/cost, evidence |

Modules may request governance decisions, but must not bypass or replace the unified decision path.

## 8. Testing Constraints

Each module needs at least:

- Schema validation tests.
- Store lifecycle tests.
- Service behavior tests when the module has a Service layer.
- Boundary tests, such as rejecting draft Specs bound to Workflow Runs.
- Regression tests for historical compatibility.

Tests should prefer temporary directories and avoid depending on real `state/`.

## 9. New Module Admission Checklist

Before adding a module, answer:

1. What is the domain object?
2. Does it need a version lifecycle?
3. What are its stable slots?
4. Which modules does it depend on?
5. Who can call it?
6. What side effects can it perform?
7. How does it integrate with Policy / Sandbox / Approval / Trace?
8. How is it tested?
9. Can it become an independent service later?

If the answers are unclear, do not add a module yet. Start with a capability or adapter inside an existing module.

## 10. Current Module Boundary Assessment

| Module | Boundary state | Next step |
|---|---|---|
| Agent Registry | Clear | Continue compatibility and provider policy |
| Skill Registry | Clear | Clarify Skill output contract and agent binding |
| Spec Hub | Initially clear | Add evidence and compliance reports |
| Workflow Registry | Clear | Strengthen templates and workflow contracts |
| Workflow Runtime | Still aggregating | Extract Queue / Worker / Governance hooks |
| Tool Hub | Mostly clear | Add MCP Adapter and per-tool policy |
| Policy Engine | Clear | Add role / admin / approval source |
| Trace Store | Clear | Add eval rubrics and regression gates |
| Work Item Orchestrator | Aggregation layer | Avoid more growth; push capabilities into modules |

## 11. Architecture Principles

- Modules should be independent first, powerful when composed.
- Workflow orchestrates; it does not define every business semantic.
- Spec defines goals and acceptance; it does not execute.
- Policy decides; it does not execute.
- Runtime executes; it does not define governance rules.
- Trace records evidence; it does not change outcomes.
- UI presents and operates; it does not bypass domain services.
