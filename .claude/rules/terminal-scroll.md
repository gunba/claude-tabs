---
paths:
  - "src/components/Terminal/TerminalPanel.tsx"
  - "src/components/Terminal/TerminalPanel.css"
  - "src/hooks/useTerminal.ts"
---

# Terminal Scroll

<!-- Codes: TR=Terminal -->

- [TR-01] Scroll-to-top and scroll-to-bottom buttons in the vertical button bar (28px right-side column). Scroll-to-top visible when not at top; scroll-to-bottom visible when not at bottom.
  - Files: src/components/Terminal/TerminalPanel.tsx
- [TR-03] Ctrl+Home scrolls to top, Ctrl+End scrolls to bottom. Handled in useTerminal's attachCustomKeyEventHandler.
  - Files: src/hooks/useTerminal.ts
- [TR-07] Vertical button bar (28px): right-side column with scroll-to-top, scroll-to-last-message, queue input, search toggle, and scroll-to-bottom. Conditionally rendered when visible and not dead; individual scroll buttons use visibility toggling.
  - Files: src/components/Terminal/TerminalPanel.tsx, src/components/Terminal/TerminalPanel.css
- [TR-08] Scroll to last user message: uses findPromptLine() to scan xterm.js buffer backward for Claude Code prompt markers (> NBSP or ❯). Accessible via button bar and Ctrl+middle-click on terminal (capture phase listener). Steps backward through prompts when not at bottom.
  - Files: src/hooks/useTerminal.ts, src/components/Terminal/TerminalPanel.tsx
- [TR-09] Ctrl+wheel snaps to top/bottom; requires zoomHotkeysEnabled: false in tauri.conf.json to prevent WebView2 zoom interception. Capture phase listener on containerRef.
  - Files: src/components/Terminal/TerminalPanel.tsx
- [TR-10] fit() deferred on tab switch via useLayoutEffect -- waits for browser layout reflow before sizing, prevents tiny-terminal bug. Cancels on rapid tab switching.
  - Files: src/components/Terminal/TerminalPanel.tsx
