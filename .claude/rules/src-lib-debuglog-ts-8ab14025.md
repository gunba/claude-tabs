---
paths:
  - "src/lib/debugLog.ts"
---

# src/lib/debugLog.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Debug Panel

- [DP-04 L38,39] Per-session buffer capacity: 3000 entries each (ring buffer, oldest evicted first). A cross-buffer total cap of 12000 entries (MAX_TOTAL_ENTRIES) is enforced by trimTotalBuffers(), which evicts from the buffer with the oldest front entry. Each terminal and global log gets its own independent buffer.
- [DP-13 L46] Per-session ring buffers: each sessionId (and null/global) has its own 3000-entry buffer in a Map. A 12000-entry cross-buffer cap (MAX_TOTAL_ENTRIES) prevents unbounded total memory; trimTotalBuffers() evicts oldest-first across all buffers. getDebugLog() merges all buffers sorted by timestamp; getDebugLogForSession(id) reads one buffer directly. DebugPanel uses per-session fetch when a session chip is selected to avoid merge cost. removeDebugLogSession() decrements totalEntryCount and deletes the buffer, keeping the total cap accurate.
- [DP-18 L84] Subscriber notifications via subscribeDebugLog are coalesced across a single animation frame. Each dlog still bumps the generation counter synchronously so getDebugLogGeneration() callers see a consistent counter; but the listener-fan-out fires at most once per frame, scheduled with requestAnimationFrame (queueMicrotask fallback for non-DOM environments). Without this, a Claude TUI redraw storm during scrolling fires hundreds of synchronous DebugPanel refreshLogs() invocations per second — each does a merge+sort over up to 12000 entries (getDebugLog(4000)) plus a 4000-row setLogs that triggers a React re-render — blocking xterm.js parsing on the main thread and producing perceived scroll lag.
  - Implementation in src/lib/debugLog.ts: scheduleNotify lambda picks requestAnimationFrame when available, else queueMicrotask; notifyScheduled flag guards against double-scheduling; debugLogListeners.size === 0 early-out avoids RAF allocation when no subscribers are attached. Unit test in src/lib/__tests__/debugLog.test.ts ('coalesces multiple bumps in the same frame into one notification') verifies the batching.
- [DP-03 L276] Reads structured `dlog()` entries from `debugLog.ts` buffer with `[HH:MM:SS.mmm] [LOG|WARN|ERR]` prefix. All app logging flows through `dlog(module, sessionId, message, level?)`.

## Development Rules

- [DR-09 L150] When constructing a dlog payload would be expensive (large strings, escape passes, decode buffers), gate the call with shouldRecordDebugLog(level, sessionId) from src/lib/debugLog.ts so the work runs only if the log would actually be recorded. perfTrace span data accepts a closure ((() => unknown)) so spans defer payload construction the same way. Used in TerminalPanel handlePtyData, useTerminal write/writeBytes/onData/onResize, ptyRegistry.writeToPty, ptyProcess.write/resize.
  - src/lib/debugLog.ts:L114 (shouldRecordDebugLog); src/lib/perfTrace.ts:L29 (TraceData = unknown | () => unknown); src/lib/perfTrace.ts:L63 (resolveTraceData).
