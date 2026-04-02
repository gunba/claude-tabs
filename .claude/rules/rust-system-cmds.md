---
paths:
  - "src-tauri/src/commands.rs"
  - "src-tauri/src/lib.rs"
---

# Rust System Commands

<!-- Codes: RC=Rust Commands -->

- [RC-10] discover_hooks / save_hooks -- Hook configuration. save_hooks merges hooks into existing settings file (preserves other keys).
  - Files: src-tauri/src/commands.rs
- [RC-11] register_active_pid / unregister_active_pid -- Frontend registers OS PIDs of PTY children; RunEvent::Exit handler in lib.rs iterates ActivePids and calls kill_process_tree_sync for each.
  - Files: src-tauri/src/commands.rs, src-tauri/src/lib.rs
- [RC-12] Config files read/write: read_config_file and write_config_file handle settings JSON, CLAUDE.md (3 scopes), and agent/skill files. list_agents and list_skills take scope param. Parent dirs auto-created on write.
  - Files: src-tauri/src/commands.rs
- [RC-13] kill_orphan_sessions: takes Vec<String> session IDs, finds processes by command line match (WMIC on Windows, pgrep on Unix). Checks for other running claude-tabs instances first -- processes that are descendants of another instance are skipped. Only kills true orphans from crashed/force-closed instances. Returns count of killed processes.
  - Files: src-tauri/src/commands.rs
- [RC-14] send_notification: Custom WinRT toast command bypassing Tauri notification plugin. Uses tauri-winrt-notification Toast with on_activated callback that emits notification-clicked event to frontend. Dev mode uses PowerShell app ID, production uses bundle identifier. spawn_blocking + CREATE_NO_WINDOW compliant.
  - Files: src-tauri/src/commands.rs
- [RC-17] search_session_content: async Rust command scanning JSONL files for substring matches. Walks ~/.claude/projects/, skips files >20MB, stops at 50 results, returns sessionId + 200-char snippet. Uses extract_message_text helper for full text extraction.
  - Files: src-tauri/src/commands.rs
- [RC-18] Plugin management IPC: plugin_list (claude plugin list --available --json), plugin_install (--scope), plugin_uninstall, plugin_enable, plugin_disable. All async with spawn_blocking + CREATE_NO_WINDOW (via run_claude_cli helper). Raw JSON passthrough for plugin_list; string result for mutations.
  - Files: src-tauri/src/commands.rs
- [RC-19] prune_worktree: runs git worktree remove --force <path> (always forced -- dialog is the confirmation). Async with spawn_blocking + CREATE_NO_WINDOW. Takes worktree_path and project_root (cwd for git).
  - Files: src-tauri/src/commands.rs
- [RC-20] resolve_api_host: hardcoded DNS resolution of api.anthropic.com via spawn_blocking + ToSocketAddrs. 5s tokio::time::timeout. Returns Cloudflare edge IP string. No parameters (least privilege). Registered in generate_handler.
  - Files: src-tauri/src/commands.rs, src-tauri/src/lib.rs
