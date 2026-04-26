---
paths:
  - "src-tauri/src/discovery/codex.rs"
---

# src-tauri/src/discovery/codex.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Codex Schema Discovery
Codex ConfigToml schema + env-var discovery primitives. Vendored Draft-07 schema with future-proof binary-mine. CODEX_* mining + curated env-var catalog.

- [CY-01 L118] discover_codex_settings_schema_sync(&Path) -> CodexSchemaResult: tries mine_schema_from_binary first, falls back to vendored_codex_settings_schema (include_str! of src-tauri/src/discovery/codex_schema.json). mine_schema_from_binary reads the file capped at 500 MiB; uses memchr::memmem to find every occurrence of the schemars Draft-07 prefix '"$schema": "http://json-schema.org/draft-07/schema#"'; for each hit walks back up to 256 bytes for '{', then runs serde_json::Deserializer streaming-parse on the remaining slice; rejects candidates whose properties don't contain all four ConfigToml signature keys (model_providers, mcp_servers, profiles, shell_environment_policy); keeps the largest match. Bundled schema must be refreshed via npm run discover:fetch-codex-schema (curl from openai/codex@main config.schema.json).
- [CY-02 L191] discover_codex_env_vars_sync(&Path) merges curated catalog with binary-mined CODEX_* names. mine_codex_env_var_names walks raw bytes (no UTF-8 decode of the ~196 MiB binary), uses memchr::memmem on prefix b'CODEX_', rejects mid-identifier hits (preceded byte in [A-Za-z0-9_]), accepts ASCII uppercase first char after PREFIX, walks forward up to 40 bytes accepting [A-Z0-9_], requires >=3 chars after PREFIX. is_noise_env_var filters Codex test/dev internals: CODEX_RS_SSE_FIXTURE, CODEX_INTERNAL_ORIGINATOR_OVERRIDE, CODEX_REFRESH_TOKEN_URL_OVERRIDE, CODEX_REVOKE_TOKEN_URL_OVERRIDE, CODEX_SNAPSHOT_OVERRIDE, CODEX_SNAPSHOT_PROXY_ENV_SET, CODEX_SNAPSHOT_PROXY_OVERRIDE, CODEX_STARTING_DIFF, CODEX_OPEN_BRACE__, CODEX_CLOSE_BRACE__. Curated catalog (~45 entries) covers auth (OPENAI_API_KEY/CODEX_API_KEY/OPENAI_BASE_URL/CODEX_GITHUB_PERSONAL_ACCESS_TOKEN/CODEX_CONNECTORS_TOKEN), runtime (CODEX_HOME/CODEX_SQLITE_HOME/CODEX_THREAD_ID/CODEX_JS_REPL_*), sandbox, network (CODEX_CA_CERTIFICATE/SSL_CERT_FILE/HTTP_PROXY/HTTPS_PROXY/NO_PROXY/NO_BROWSER), exec/app server, cloud tasks, and TUI/debug. Result is sorted documented-first then by category then name.
