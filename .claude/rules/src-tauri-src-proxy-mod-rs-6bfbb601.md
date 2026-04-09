---
paths:
  - "src-tauri/src/proxy/mod.rs"
---

# src-tauri/src/proxy/mod.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Provider Routing
Session-bound provider routing, OpenAI Codex provider config, and auth-backed request translation.

- [PR-01 L1051] TerminalPanel points Claude at a session-scoped proxy URL (/s/{sessionId}) and binds each session to providerId; the Rust proxy resolves that session-bound provider, applies provider-local modelMappings, and falls back to the default provider when no binding is present.
