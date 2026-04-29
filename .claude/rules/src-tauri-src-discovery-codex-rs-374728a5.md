---
paths:
  - "src-tauri/src/discovery/codex.rs"
---

# src-tauri/src/discovery/codex.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Codex Schema Discovery
Codex ConfigToml schema + env-var discovery primitives. Vendored Draft-07 schema with future-proof binary-mine. CODEX_* mining + curated env-var catalog.

- [CY-01 L118] [CY-01] discover_codex_settings_schema_sync(&Path) -> CodexSchemaResult tries mine_schema_from_binary first, then falls back to vendored_codex_settings_schema (include_str! of src-tauri/src/discovery/codex_schema.json). mine_schema_from_binary reads the file capped at 500 MiB; uses memchr::memmem to find every schemars Draft-07 prefix '"": "http://json-schema.org/draft-07/schema#"'; for each hit it walks back up to 256 bytes for '{', streaming-parses JSON from that slice, rejects candidates whose properties lack ConfigToml signature keys (model_providers, mcp_servers, profiles, shell_environment_policy), keeps the largest match, and logs the probe-hit count at debug level when no ConfigToml match is found. Bundled schema must be refreshed via npm run discover:fetch-codex-schema (curl from openai/codex@main config.schema.json).
- [CY-02 L197] [CY-02] discover_codex_env_vars_sync(&Path) merges curated catalog with binary-mined CODEX_* names. mine_codex_env_var_names walks raw bytes (no UTF-8 decode of the ~196 MiB binary), uses memchr::memmem on prefix b'CODEX_', rejects mid-identifier hits (preceded byte in [A-Za-z0-9_]), accepts ASCII uppercase first char after PREFIX, walks forward up to 80 bytes accepting [A-Z0-9_], and requires >=3 chars after PREFIX. is_noise_env_var filters Codex test/dev internals: CODEX_RS_SSE_FIXTURE, CODEX_INTERNAL_ORIGINATOR_OVERRIDE, CODEX_REFRESH_TOKEN_URL_OVERRIDE, CODEX_REVOKE_TOKEN_URL_OVERRIDE, CODEX_SNAPSHOT_OVERRIDE, CODEX_SNAPSHOT_PROXY_ENV_SET, CODEX_SNAPSHOT_PROXY_OVERRIDE, CODEX_STARTING_DIFF, CODEX_OPEN_BRACE__, CODEX_CLOSE_BRACE__. Curated catalog covers auth, runtime, sandbox, network, exec/app server, cloud tasks, and TUI/debug variables. Result is sorted documented-first then by category then name.
