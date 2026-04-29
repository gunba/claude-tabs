---
paths:
  - "src-tauri/src/pty/mod.rs"
---

# src-tauri/src/pty/mod.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## PTY Output

- [PT-16 L285] PTY output flows pty_read (Tauri) -> Uint8Array chunks -> useTerminal.writeBytes -> TerminalWriteQueue (enqueueTerminalWrite) -> flushWriteQueue -> term.write(batch.data). Hidden tabs (visibleRef.current=false) keep chunks queued; useEffect on visible flips drains the queue. Adjacent Uint8Array chunks merge up to 256KB before a single term.write call. Decoding to text is deferred until a debug log/perf span needs it (terminalOutputDecoder shared at module scope).
- [PT-27 L311] pty_read drains queued chunks in addition to the blocking recv to cut IPC round-trips during high-throughput output. After mpsc::recv() yields the first chunk, the loop runs try_recv() and appends additional chunks while the accumulated len() < PTY_READ_BATCH_MAX_BYTES (256KB). On Empty/Disconnected the drain stops and the response returns. No timers or polling — try_recv is non-blocking and returns immediately when the channel is empty.
  - src-tauri/src/pty/mod.rs:L23 (PTY_READ_BATCH_MAX_BYTES constant); src-tauri/src/pty/mod.rs:L171 (drain loop in pty_read). Pairs with the frontend write batching path (DF-03/PT-16).

## PTY Spawn

- [PT-19 L152] TERM=xterm-ghostty, TERM_PROGRAM=ghostty, and COLORTERM=truecolor are injected before the caller-supplied env in unix.rs spawn(), so caller entries win on conflict. This ensures color-aware CLIs get a capable terminal type and enables TUI sync output (see PT-23 for the ghostty-specific DEC 2026 rationale).
  - src-tauri/src/pty/unix.rs:L206
- [PT-23 L153] Linux PTY spawn sets TERM=xterm-ghostty + TERM_PROGRAM=ghostty before the caller env so Claude Code's isSynchronizedOutputSupported() (env-sniff on TERM / TERM_PROGRAM in src/ink/terminal.ts) returns true and the TUI wraps diff frames in BSU/ESU (DEC 2026). Without this, ink.tsx L736 passes skipSyncMarkers=true and emits raw incremental patches; each keystroke's render output lands one-behind in xterm.js because the buffer only flushes when the next input triggers another render. xterm.js 6.0 handles DEC 2026 correctly; ghostty's terminfo is xterm-compatible so color/mouse/key sequences stay identical.
- [PT-18 L452] Shutdown drain: pty_drain_output command empties the channel (500ms deadline, 10ms intervals) before session destroy, preventing the background reader thread from blocking on a full channel.
