---
paths:
  - "src/lib/ptyRegistry.ts"
---

# src/lib/ptyRegistry.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Data Flow

- [DF-01 L42] User types in xterm.js -> onData -> writeToPty(sessionId, data) (ptyRegistry.ts: looks up registered writer, calls write(data); no slash-command parsing) -> registered writer invokes pty_write Tauri command -> PTY (ConPTY on Windows, openpty on Linux) -> Claude/Codex stdin
