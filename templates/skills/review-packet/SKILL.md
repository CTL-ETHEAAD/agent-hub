---
name: review-packet
description: Produce an evidence-backed code and security review packet for one Work Item or workflow run.
---

# Review Packet

Use this skill after implementation and validation evidence are available.

## Steps

1. Read the repository profile, project guidance, approved roadmap, validation results, and scoped diff.
2. Review changed files with surrounding context.
3. Evaluate correctness, regressions, missing tests, secrets, injection, authorization, unsafe rendering, and dependency risks.
4. Keep findings scoped to the supplied change unless unchanged code creates a direct critical risk.
5. Write one review packet to the supplied path.

## Output Contract

```md
# AI Review: {workItemId}

## Blocking Findings

No blocking findings.

## Medium/Low Findings

None.

## Verification

- ...

## Diff Summary

- ...
```

Use `CRITICAL:` or `HIGH:` only for real blocking findings. For work expected from another owned task, use `DEPENDENCY:` rather than a blocking severity.

## Rules

- Only report findings likely to be real and actionable.
- Include file path and line reference when possible.
- Never expose secrets or full sensitive inputs in the packet.
