---
paths:
  - "src-tauri/src/discovery/mod.rs"
---

# src-tauri/src/discovery/mod.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Discovery Module

- [DM-01 L15] Discovery primitives are split per-CLI: src-tauri/src/discovery/claude.rs holds Claude-specific functions (read_claude_binary, discover_builtin_commands_sync, discover_settings_schema_sync, discover_env_vars_sync, discover_plugin_commands_sync, env_var_catalog), src-tauri/src/discovery/codex.rs holds Codex-specific functions (discover_codex_settings_schema_sync, discover_codex_env_vars_sync, codex_env_var_catalog, vendored_codex_settings_schema), and src-tauri/src/discovery/mod.rs holds shared types and helpers (DiscoveredEnvVar, PluginScanRejection, scan_skill_md/parse_skill_frontmatter/is_valid_skill_slug). mod.rs re-exports claude via pub use claude::* so existing call sites (commands::cli, commands::codex_cli, bin/discover_audit) keep importing from crate::discovery::<symbol>. All three submodules are pure sync primitives with no Tauri types — same code runs in the runtime app and the standalone discover_audit binary.
- [DM-02 L45] scan_skill_md implements Claude Code's skill resolution order: name = frontmatter 'name:' if present, else parent directory name (must be a valid slug: ASCII letter start, alphanumeric/-/_). description = frontmatter 'description:' if present, else first non-empty body line (truncated to 120 chars). A SKILL.md is rejected only when both name sources fail; rejection reason is returned to the Tauri caller for WARN-level observability logging.
