---
paths:
  - "src/hooks/useCliWatcher.ts"
---

# src/hooks/useCliWatcher.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Per-CLI Watcher

- [PR-01 L13] useCliWatcher splits checkClaude and checkCodex as parallel Promise.allSettled branches. checkClaude invokes check_cli_version + get_cli_help; calls setCliCapabilitiesForCli('claude',...). checkCodex invokes check_codex_cli_version, then concurrently get_codex_cli_help + discover_codex_models + discover_codex_cli_options; normalizeCodexCapabilities merges parsed help with discover_codex_models slugs and discover_codex_cli_options into CliCapabilities; calls setCliCapabilitiesForCli('codex',...). Both functions store empty capabilities on failure. useCliWatcher is a single-run effect (checkedRef) gated on useSessionStore.initialized — fires immediately once init() completes (the prior 500ms setTimeout was removed in d0fbe5b).
- [PR-02 L158] Codex schema + env var discovery is kicked from useCliWatcher.checkCodex success path: useSettingsStore.getState().loadSettingsSchemaForCli('codex') and loadKnownEnvVarsForCli('codex'). Both run in the background (no await on the watcher's success branch) and degrade gracefully via dlog WARN on failure. Schema loader hits Tauri command discover_codex_settings_schema (vendored fallback always succeeds); env var loader hits discover_codex_env_vars (binary required).
