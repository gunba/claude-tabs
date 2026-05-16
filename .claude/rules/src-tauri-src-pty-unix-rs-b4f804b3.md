---
paths:
  - "src-tauri/src/pty/unix.rs"
---

# src-tauri/src/pty/unix.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## PTY Output

- [PT-25 L58] Unix PTY resize is independent of child-process waiting: UnixPty::resize delegates to resize_fd(master_fd, cols, rows), and resize_fd writes TIOCSWINSZ directly to the master fd without locking the child mutex. UnixPty::wait locks only child: Mutex<Option<Child>> long enough to take the Child before blocking in wait(), while pty_exitstatus subscribes to session.exit_tx instead of calling wait itself. Resize therefore remains independent while the exit watcher owns the child wait path.
- [PT-28 L106,260,280] Mouse-tracking SGR sequences (\\x1b[?1003h\\x1b[?1006h, with the matching disable on alt-screen exit) are written unconditionally — they were previously gated by an enableMouseTracking prop that defaulted true for Claude but false for Codex on Windows. Two trigger sites: (1) term.buffer.onBufferChange enables on alt-screen entry / disables on normal-screen return; (2) the XTVERSION CSI > 0 q parser handler re-enables after ConPTY's VTUI-init strip on Windows. Codex never consumes mouse events (codex-rs/tui/src/tui/event_stream.rs filters all non-Key/Resize/Paste/Focus events to None) so the unconditional write is a no-op for Codex; for Claude the SGR enable is required so wheel and motion reports reach the TUI. The previously-existing carve-out was a stale workaround from the Codex Windows cursor-flicker investigation — the real flicker root cause was ConPTY stripping DECSET 2026, fixed separately by wrapping PTY reads in DEC 2026 synchronized output.
- [PT-15 L291] Background reader thread per session: OS thread reads ConPTY pipe (8 KiB buffer) into bounded sync_channel(64). Decouples blocking pipe reads from IPC, enabling timeout-based reads in the pty_read command.

## Data Flow

- [DF-02 L291] [DF-02] Claude/Codex stdout -> PTY (ConPTY on Windows / openpty on Linux) -> background reader thread (8 KiB buffer) -> bounded tokio mpsc channel(64) using blocking_send from the OS reader thread -> pty_read drains queued chunks up to 256KB (PT-27) -> Tauri IPC response -> Uint8Array. There is no in-process OutputFilter or SyncBlockDetector; sync output coalescing is delegated to xterm.js 6.0 (DEC 2026 BSU/ESU).

## PTY Spawn

- [PT-20 L80] UnixPty::kill() sends SIGKILL to the negative PGID (libc::kill(-pgid, SIGKILL)) to tear down the entire process group, including grandchildren (tools spawned by the CLI). ESRCH (no such process group) is treated as Ok since the goal — no live processes — is already met. This mirrors ConPTY's Windows-side tree teardown.
- [PT-26 L105] UnixPty.wait() uses stdlib Child.wait() + ExitStatusExt to preserve the 128+signal exit code convention: if the child was killed by signal N, wait() returns 128+N (matching the POSIX shell convention and frontend exitCode checks). The child is wrapped in Mutex<Option<Child>>; take() consumes it so double-wait panics with 'wait already consumed' rather than silently returning 0.
  - src-tauri/src/pty/unix.rs:L102
- [PT-21 L148] openpty_pair() returns an OwnedFd pair so both fds are closed by Drop on any early return. In spawn(), each dup is also wrapped in OwnedFd immediately after creation; Stdio::from_raw_fd consumes the fd via into_raw_fd() only after all dups succeed. The master OwnedFd is converted to a raw int via into_raw_fd() only after cmd.spawn() succeeds and ownership transfers to UnixPty::master_fd.
- [PT-22 L245] In unix.rs pre_exec, after setsid/TIOCSCTTY, call prctl(PR_SET_PDEATHSIG, SIGKILL) so the direct PTY child receives SIGKILL when the Tauri parent dies for any reason (hard crash or SIGKILL included). Must run AFTER setsid — setsid clears the parent-death signal. Persists across exec for non-setuid targets. Grandchildren spawned by the CLI are NOT covered by PDEATHSIG; complete tree teardown on hard crash would need cgroups/systemd or a reaper subprocess.
