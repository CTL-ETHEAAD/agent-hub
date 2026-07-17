# Agent Hub Update Notes

[简体中文](UPDATE_NOTES.md) | [English](UPDATE_NOTES.en.md)

## Overview

This evolution moves Agent Hub from a local Agent workspace toward the mainline Agent OS skeleton. The core shift is that Workflow execution is no longer just in-process function calls. It now has versioned contracts, recoverable Node Runs, multiprocess Workers, resource scheduling, Sandbox / Worktree boundaries, governed delegation, and governance snapshots.

Current positioning:

> Agent OS skeleton complete.

The main control-plane and execution-plane objects are now in place for production hardening. The remaining work is product UI, stronger runtime isolation, database Stores, production queues, RBAC, and Eval Gates.

## Branch and Phase Order

Recommended merge order:

1. `feature/schema-compatibility-v1`
2. `feature/node-run-persistence-v1`
3. `feature/local-worker-runtime-v1`
4. `feature/worker-node-handlers-v1`
5. `feature/scheduler-resource-policy-v1`
6. `feature/worktree-sandbox-boundary-v1`
7. `feature/delegation-governance-v1`

## Phase 1: Building-block Contract Standardization

Related branches:

- `feature/node-contract-v1`
- `feature/schema-compatibility-v1`

Updates:

- Added Node Contract v1.
- Added static Workflow reference validation.
- Added Contract Catalog API.
- Resolved and pinned Agent, Tool, and subworkflow versions during Workflow publication.
- Generated Schema compatibility reports when publishing new Agent / Tool versions.
- Detected breaking Schema changes across required fields, properties, types, enums, and additionalProperties.

Value:

- Workflow building blocks are safer to compose.
- Unpinned assets no longer drift at runtime when newer versions are published.
- Agent / Tool upgrades can detect breaking contract changes.

## Phase 2: Node Run Persistence

Related branch:

- `feature/node-run-persistence-v1`

Updates:

- Added an independent Node Run data model.
- Added Node Run Store and Service.
- Supported `queued`, `claimed`, `running`, `waiting`, `succeeded`, `failed`, `cancelled`, and `interrupted` states.
- Added attempts, idempotency keys, input snapshots, output references, and error snapshots.
- Mirrored Workflow node start, input, waiting, success, failure, and cancellation into Node Runs.
- Added read-only APIs:
  - `GET /api/workflow-runs/:id/node-runs`
  - `GET /api/node-runs/:id`

Value:

- Workflow nodes become recoverable tasks instead of only in-process calls.
- Scheduler / Worker execution can build on Node Runs.
- Run details and node timelines now have a stable data source.

## Phase 3: Local Multiprocess Workers

Related branches:

- `feature/local-worker-runtime-v1`
- `feature/worker-node-handlers-v1`

Updates:

- Added Worker Registry.
- Added Worker heartbeat, capability tags, concurrency slots, and active Node Runs.
- Implemented Node Run claim / lease / renew / complete protocol.
- Added expired lease recovery and stale Worker marking.
- Added local CLI commands:
  - `agent-hub worker`
  - `agent-hub scheduler`
- Workers support pluggable handlers.
- Built-in handlers now support start, condition, end, agent, and tool nodes.
- Agent nodes reuse Agent Service.
- Tool nodes reuse Tool Service and Policy checks.
- Added Worker query APIs:
  - `GET /api/workers`
  - `GET /api/workers/:id`

Value:

- Execution starts moving out of the Server process.
- Multiple local Workers can consume different Node Runs.
- Agent / Tool nodes now have a worker-native execution foundation.

## Phase 4: Resource Scheduling and Real Parallelism Foundation

Related branch:

- `feature/scheduler-resource-policy-v1`

Updates:

- Added Node Run scheduling metadata.
- Added priority.
- Added requiredCapabilities.
- Worker claim now considers:
  - Worker capability tags.
  - Active slots / concurrency slots.
  - Node Run priority.
- Fixed Worker re-registration so activeNodeRunIds are not reset.

Value:

- Workers do not claim tasks they cannot execute.
- Fully occupied Workers do not claim additional work.
- Higher-priority tasks can be scheduled first.
- This lays the foundation for real Parallel / Join scheduling.

## Phase 5: Worktree / Sandbox Boundary

Related branch:

- `feature/worktree-sandbox-boundary-v1`

Updates:

- Added Worktree Lease Service.
- Added exclusive worktree lock, release, and expiry recovery.
- Added stable worktree key derivation.
- Added sandbox runtime resolver.
- Workers resolve a sandbox snapshot before executing Node Runs.
- Isolated, workspace-write, or git-writing code nodes acquire a worktree lease.
- Worker handlers can read sandboxSnapshot.

Value:

- Multiple implementation Agents do not write to the same workspace.
- Sandbox decisions enter the Worker execution boundary.
- The system is ready for real worktree creation, network enforcement, and secret leasing.

## Phase 6: Dynamic Supervisor and Sub-agents

Related branch:

- `feature/delegation-governance-v1`

Updates:

- Agent Runs now include delegation metadata:
  - `rootRunId`
  - `parentRunId`
  - `depth`
  - `delegationReason`
- Added governed Agent delegation service.
- Delegation enforces:
  - maxDepth.
  - Child count per parent run.
  - Allowed-agent allowlist.
- Added Run Tree query.
- Added tree cancellation entry point.
- Added APIs:
  - `POST /api/agent-runs/:id/delegate`
  - `GET /api/agent-runs/:id/tree`
  - `POST /api/agent-runs/:id/cancel-tree`

Value:

- Dynamic Sub-agents are no longer uncontrolled privilege expansion.
- Every delegation has parent, root, depth, and reason metadata.
- Run Tree can trace dynamic delegation structure.

## Phase 7: Distributed Governance Foundation

Related branch:

- `feature/delegation-governance-v1`

Updates:

- Worker Registry now stores capability attestation:
  - subject
  - issuer
  - issuedAt / expiresAt
  - capabilityTags
  - signature
  - verified
- Added Governance Snapshot Service.
- Governance Snapshot summarizes:
  - Agent Run states.
  - Workflow Run states.
  - Worker attestation state.
  - Trace type counts.
  - Baseline regression gate result.
- Added Admin API:
  - `GET /api/admin/governance-snapshot`

Value:

- Worker identity and capabilities now have attestable fields.
- Admin surfaces can inspect runs, Workers, Traces, and gate state.
- The design leaves replacement points for database Stores, Queue/Event Bus, RBAC, audit export, and production deployment.

## Current Capability Summary

Implemented foundations:

- Versioned Agent / Skill / Tool / Workflow / Policy.
- Node Contract v1.
- Schema compatibility report.
- Workflow asset version pinning.
- Node Run persistence and state machine.
- Worker Registry, lease, and local Worker Runtime.
- Agent / Tool Worker Handlers.
- Worker capability / priority / slot scheduling.
- Sandbox snapshot.
- Worktree Lease.
- Delegation / Run Tree.
- Worker attestation.
- Governance Snapshot.

Still to deepen:

- Fully queue-driven Workflow Runtime.
- Complete Parallel / Join fail-fast, wait-all, and partial-success strategies.
- Real Worktree creation, cleanup, and retention.
- Strong network isolation and secret lease enforcement.
- UI for Run Tree, Workers, Governance, and Parallel Timeline.
- Store Adapter, SQLite / Postgres, and production Queue.
- RBAC, Approval Center, and Audit Export.
- Trace-based Eval, Rubrics, AutoRater, and Release Gate.

## Recommended Next Steps

1. Productize Run Detail and Worker views.
2. Move Workflow Runtime fully onto Node Run Queue.
3. Harden Worktree Manager and Sandbox enforcement.
4. Add Approval Center and Governance Dashboard.
5. Extract Store Adapter and implement SQLite / Postgres.
6. Add Trace-based Eval and Regression Gate.
