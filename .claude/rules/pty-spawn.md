---
paths:
  - "src/lib/ptyProcess.ts"
  - "src/hooks/usePty.ts"
  - "src-tauri/src/pty/**"
  - "src-tauri/src/lib.rs"
  - "src/components/Terminal/TerminalPanel.tsx"
---

# PTY Spawn

<!-- Codes: PT=PTY Internals -->

- [PT-01] Direct PTY wrapper (ptyProcess.ts) calls invoke('pty_spawn'/'pty_read'/etc) for PTY data -- not the tauri-pty npm package or raw Tauri event listeners.
  - Files: src/lib/ptyProcess.ts
- [PT-03] CLAUDECODE env var is stripped at Rust app startup (lib.rs) so spawned PTYs do not think they are nested inside another Claude Code session.
  - Files: src-tauri/src/lib.rs
- [PT-04] Kill button (pty.kill()) always fires exitCallback exactly once via exitFired guard -- whether kill or natural exit completes first.
  - Files: src/lib/ptyProcess.ts
- [PT-07] OS PID registered in global cleanup registry (ptyProcess.ts) immediately on PTY spawn; unregistered on explicit kill. Dual-layer: frontend fires kill_process_tree on beforeunload, Rust ActivePids state kills on RunEvent::Exit as backstop.
  - Files: src/lib/ptyProcess.ts, src-tauri/src/lib.rs
- [PT-10] Parallel exit waiter: fire-and-forget invoke('pty_exitstatus') runs alongside read loop. On Windows ConPTY, read pipe may hang after Ctrl+C; exitstatus uses WaitForSingleObject which reliably returns. exitFired guard ensures exactly one callback fires.
  - Files: src/lib/ptyProcess.ts
- [PT-18] Shutdown drain: pty_drain_output command empties the channel (500ms deadline, 10ms intervals) before session destroy, preventing the background reader thread from blocking on a full channel.
  - Files: src-tauri/src/pty/mod.rs, src/lib/ptyProcess.ts
- [TR-15] Proxy env injection at PTY spawn: when proxyPort is set in settings store, ANTHROPIC_BASE_URL=http://127.0.0.1:{port} is added to the child env. This redirects all Claude Code API calls through the local proxy for multi-provider routing.
  - Files: src/components/Terminal/TerminalPanel.tsx
