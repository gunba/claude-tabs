---
paths:
  - "src-tauri/src/proxy/codex/response_shape.rs"
---

# src-tauri/src/proxy/codex/response_shape.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Provider Routing
Session-bound provider routing, OpenAI Codex provider config, and auth-backed request translation.

- [PR-04 L5] Codex proxy shaping normalizes short Claude aliases best, opusplan, sonnet, opus, and haiku (and any model starting with 'claude') to the configured primary or small OpenAI Codex model (default: gpt-5.5 / gpt-5.5-mini). Strips [1m] context suffix and ANSI bracket codes before matching. Non-Claude model strings pass through unchanged. source: src-tauri/src/proxy/codex/mod.rs:L44
