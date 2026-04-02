---
paths:
  - "src/components/Terminal/TerminalPanel.tsx"
---

# Background Buffering

<!-- Codes: BF=Background Buffering -->

- [BF-01] Background tabs: PTY data buffered in bgBufferRef, flushed via useLayoutEffect on tab focus. Container hidden with opacity:0 (not visibility:hidden -- keeps WebGL renderer active). Reveal deferred to rAF after write or term.write callback. For no-buffer tab switch, term.write('', callback) forces a render cycle to guarantee the callback fires. O(1) rendering cost while hidden.
  - Files: src/components/Terminal/TerminalPanel.tsx
- [BF-02] visibleRef tracks tab visibility for buffering decisions. Updated via visibleRef.current = visible on each render. Checked in handlePtyData and handleResize.
  - Files: src/components/Terminal/TerminalPanel.tsx
- [BF-03] Resize occlusion: handleResize defers PTY resize when tab is hidden (visibleRef) or bgBuffer has pending data. Deferred dimensions stored in deferredResizeRef and applied when tab becomes visible in the useLayoutEffect flush.
  - Files: src/components/Terminal/TerminalPanel.tsx
