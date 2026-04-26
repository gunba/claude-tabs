---
paths:
  - "src-tauri/src/pty/mod.rs"
---

# src-tauri/src/pty/mod.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## PTY Output

- [PT-16 L151] PTY output flows pty_read (Tauri) -> Uint8Array chunks -> useTerminal.writeBytes -> TerminalWriteQueue (enqueueTerminalWrite) -> flushWriteQueue -> term.write(batch.data). Hidden tabs (visibleRef.current=false) keep chunks queued; useEffect on visible flips drains the queue. Adjacent Uint8Array chunks merge up to 256KB before a single term.write call. Decoding to text is deferred until a debug log/perf span needs it (terminalOutputDecoder shared at module scope).
- [PT-27 L174] pty_read drains queued chunks in addition to the blocking recv to cut IPC round-trips during high-throughput output. After mpsc::recv() yields the first chunk, the loop runs try_recv() and appends additional chunks while the accumulated len() < PTY_READ_BATCH_MAX_BYTES (256KB). On Empty/Disconnected the drain stops and the response returns. No timers or polling — try_recv is non-blocking and returns immediately when the channel is empty.
  - src-tauri/src/pty/mod.rs:L23 (PTY_READ_BATCH_MAX_BYTES constant); src-tauri/src/pty/mod.rs:L171 (drain loop in pty_read). Pairs with the frontend write batching path (DF-03/PT-16).
- [PT-25 L210] Lock-free on Unix: pty_exitstatus holds session.pty's std::sync::Mutex for the whole session lifetime via child.wait(), so resize cannot take that lock. The master fd is safe to ioctl concurrently.

## PTY Spawn

- [PT-18 L315] Shutdown drain: pty_drain_output command empties the channel (500ms deadline, 10ms intervals) before session destroy, preventing the background reader thread from blocking on a full channel.
