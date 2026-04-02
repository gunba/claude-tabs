---
paths:
  - "src/components/Terminal/TerminalPanel.tsx"
  - "src/components/Terminal/TerminalPanel.css"
  - "src/hooks/useTerminal.ts"
  - "src-tauri/src/output_filter.rs"
  - "src-tauri/src/pty/**"
---

# PTY Output

<!-- Codes: PT=PTY Internals -->

- [PT-06] Fixed 1M scrollback buffer in useTerminal -- no dynamic resizing. Set via scrollback option on Terminal constructor.
  - Files: src/hooks/useTerminal.ts
- [PT-08] Scroll desync fix: xterm-viewport uses overflow-y:scroll with hidden scrollbar (scrollbar-width:none + ::-webkit-scrollbar) instead of overflow:hidden. isAtBottom/isAtTop use 2-line BOTTOM_TOLERANCE for near-bottom snap.
  - Files: src/components/Terminal/TerminalPanel.css, src/hooks/useTerminal.ts
- [PT-09] FitAddon dimension guard: fit() calls check proposeDimensions() first -- if rows <= 1, container is not laid out yet and fit is skipped. Applied in useTerminal wrapper, initial attach, and ResizeObserver.
  - Files: src/hooks/useTerminal.ts
- [PT-11] Respawn clears both bgBufferRef and useTerminal's writeBatchRef (via clearPending()) before writing c. Without this, stale PTY data from previous sessions survives the terminal reset and gets flushed when the tab becomes visible.
  - Files: src/components/Terminal/TerminalPanel.tsx, src/hooks/useTerminal.ts
- [PT-12] Pre-spawn fit() + post-spawn rAF dimension verification prevents 80-col race when font metrics or WebGL renderer are not ready during initial layout.
  - Files: src/components/Terminal/TerminalPanel.tsx
- [PT-13] Same-dimension gate: handleResize tracks last PTY dims in a ref; skips redundant pty.resize() calls when cols/rows unchanged. Prevents ConPTY reflow duplication from layout-triggered ResizeObserver events.
  - Files: src/components/Terminal/TerminalPanel.tsx
- [PT-15] Background reader thread per session: OS thread reads ConPTY pipe (8 KiB buffer) into bounded sync_channel(64). Decouples blocking pipe reads from IPC, enabling timeout-based reads in the pty_read command.
  - Files: src-tauri/src/pty/conpty.rs
- [PT-16] DEC 2026 sync handling: xterm.js 6.0 handles DEC 2026 synchronized updates natively. Output passes through OutputFilter directly to IPC without sync block coalescing. Frontend writeBytes uses debounced batching (4ms quiet / 50ms max) to coalesce ConPTY fragments.
  - Files: src-tauri/src/pty/mod.rs, src/hooks/useTerminal.ts
- [PT-17] Output security filter: byte-level state machine strips OSC 52 (clipboard hijack), DCS sequences, C1 controls (including cross-chunk PendingC2 state). ESC[3J (scrollback erase) is always stripped. ESC[2J is replaced with ESC[3J + ESC[H + ESC[J to clear scrollback before full redraws.
  - Files: src-tauri/src/output_filter.rs
- [PT-20] Scrollback handling: OutputFilter replaces ESC[2J with ESC[3J+ESC[H+ESC[J to prevent scrollback duplication from viewport overflow during full redraws. Frontend flushWrites detects scrollback clear (baseY shrinkage) and scrolls to bottom. handleResize defers PTY resize for hidden tabs (visibility gate) and when bgBuffer has pending data.
  - Files: src-tauri/src/output_filter.rs, src/hooks/useTerminal.ts, src/components/Terminal/TerminalPanel.tsx
