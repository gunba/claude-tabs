---
paths:
  - "src-tauri/src/commands/cli.rs"
---

# src-tauri/src/commands/cli.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Rust Command Modules

- [RC-05 L30] detect_claude_cli / check_cli_version / get_cli_help -- CLI discovery. spawn_blocking + CREATE_NO_WINDOW compliant.
- [RC-16 L220] read_claude_binary(cli_path) resolves Claude Code binary through 5-step chain: .cmd shim parse -> direct CLI path -> sibling node_modules -> legacy versions dir -> npm root -g. Enables slash command/settings discovery on standalone installs.
- [RC-09 L372] discover_builtin_commands / discover_plugin_commands -- Slash command discovery. Two-step binary scan (name:"..." positions + forward/reverse brace-bounded window for descriptions). Filters: skips /-- prefixed names, skips descriptions containing 'tab ID' or 'DOM', requires cmd length 4-30 chars. Deduplicates by command name.
- [RC-02 L1140] build_claude_args -- SessionConfig -> CLI args (--resume, --session-id, --project-dir, etc.)

## Respawn & Resume

- [RS-05 L1261] Skip `--session-id` CLI arg when using `--resume` or `--continue`

## Rust System Command Modules

- [RC-18 L1359] Plugin management IPC: plugin_list (claude plugin list --available --json), plugin_install (--scope), plugin_uninstall, plugin_enable, plugin_disable. All async with spawn_blocking + CREATE_NO_WINDOW (via run_claude_cli helper). Raw JSON passthrough for plugin_list; string result for mutations.

## Config Schema and Providers

- [CM-03 L986] Project directory selector: when multiple working dirs exist across sessions, the config modal header shows a dropdown to switch between project-level scopes. settingsSchema.ts builds the schema; fetch_settings_schema provides the Rust backend.
