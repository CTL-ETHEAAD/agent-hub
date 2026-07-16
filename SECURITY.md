# Security Policy

Agent Hub executes model output, repository tools, and optional network requests. Run it on a trusted machine and review approvals before enabling write-capable actions.

## Safe defaults

- The server binds to `127.0.0.1` by default.
- Remote binding is refused unless `AGENT_HUB_ALLOW_REMOTE=true` and `AGENT_HUB_AUTH_TOKEN` are both configured.
- OpenAI-compatible endpoints and secret environment names must be explicitly allowlisted.
- Runtime state may contain source context and model output; the complete `state/` directory is ignored by Git.

## Reporting

Do not open a public issue containing credentials, private prompts, traces, or repository contents. Use the repository's private security-reporting channel when one is configured.
