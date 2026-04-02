---
paths:
  - "src-tauri/src/commands.rs"
  - "src-tauri/src/jsonl_watcher.rs"
---

# Rust Session Commands

<!-- Codes: RC=Rust Commands -->

- [RC-01] create_session / close_session -- Session CRUD. close_session does not persist; frontend owns persistence via persist_sessions_json.
  - Files: src-tauri/src/commands.rs
- [RC-02] build_claude_args -- SessionConfig -> CLI args (--resume, --session-id, --project-dir, etc.)
  - Files: src-tauri/src/commands.rs
- [RC-03] start_jsonl_watcher / stop_jsonl_watcher -- Tail JSONL files, emit events (fast scan for resumed sessions).
  - Files: src-tauri/src/jsonl_watcher.rs
- [RC-04] find_continuation_session -- Detect plan-mode forks via sessionId in first events of other JSONL files.
  - Files: src-tauri/src/jsonl_watcher.rs
- [RC-05] detect_claude_cli / check_cli_version / get_cli_help -- CLI discovery. spawn_blocking + CREATE_NO_WINDOW compliant.
  - Files: src-tauri/src/commands.rs
- [RC-06] list_past_sessions -- Scan ~/.claude/projects/ for resumable sessions. Async with spawn_blocking. Head pass reads first 30 lines for firstMessage + sourceToolAssistantUUID; tail pass seeks last 256KB for lastMessage + model. Chain detection resolves sourceToolAssistantUUID to parent session via UUID map.
  - Files: src-tauri/src/commands.rs
- [RC-07] get_first_user_message -- Read first user message from session JSONL.
  - Files: src-tauri/src/commands.rs
- [RC-08] persist_sessions_json / load_persisted_sessions -- Save/restore sessions. persist_sessions_json accepts frontend JSON directly (Rust-side metadata is stale).
  - Files: src-tauri/src/commands.rs
- [RC-09] discover_builtin_commands / discover_plugin_commands -- Slash command discovery. Builtin scans Claude binary for command registration patterns; plugin scans command directories.
  - Files: src-tauri/src/commands.rs
- [RC-16] read_claude_binary(cli_path) resolves Claude Code binary through 5-step chain: .cmd shim parse -> direct CLI path -> sibling node_modules -> legacy versions dir -> npm root -g. Enables slash command/settings discovery on standalone installs.
  - Files: src-tauri/src/commands.rs
