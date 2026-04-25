---
paths:
  - "src/hooks/useCliWatcher.ts"
---

# src/hooks/useCliWatcher.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Per-CLI Watcher

- [PR-01 L12] useCliWatcher splits checkClaude and checkCodex as parallel Promise.allSettled branches. checkClaude invokes check_cli_version + get_cli_help; calls setCliCapabilitiesForCli('claude',...). checkCodex invokes check_codex_cli_version, then concurrently get_codex_cli_help + discover_codex_models + discover_codex_cli_options; normalizeCodexCapabilities merges parsed help with discover_codex_models slugs and discover_codex_cli_options into CliCapabilities; calls setCliCapabilitiesForCli('codex',...). Both functions store empty capabilities on failure. useCliWatcher is a single-run effect (checkedRef) with a 500ms deferred start.
