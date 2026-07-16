---
name: isolated-implementation
description: Implement an approved Work Item plan in an isolated worktree with scoped changes and focused validation.
---

# Isolated Implementation

Use this skill only after an approved implementation plan is available.

## Steps

1. Read the repository profile, project guidance, and approved roadmap.
2. Confirm the current directory is the assigned isolated worktree.
3. Inspect the current branch and `git status --short`.
4. Implement only the approved scope and owned files.
5. Add or update focused tests for every behavior change.
6. Run the repository-specific relevant test command.
7. Return a concise structured summary: changed files, validation evidence, residual risks, and blockers.

## Rules

- Do not install dependencies or update lockfiles unless the approved plan explicitly requires it.
- Do not make unrelated refactors or introduce new abstractions without plan approval.
- Do not edit sibling-owned files in a split workflow; report a dependency instead.
- Do not commit, push, create a pull request, or call external write tools. Those actions require separate governed delivery steps.

## Stop Conditions

Report `BLOCKED` when the plan is materially incomplete, the worktree has unsafe unrelated edits, required context is unavailable, or an unowned file must change.
