---
paths:
  - "src/hooks/useKeyboardShortcuts.ts"
---

# src/hooks/useKeyboardShortcuts.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Keyboard Shortcuts

- [KB-01 L79] Ctrl+Shift+N — New session
- [KB-02 L86] Ctrl+W — Close active tab
- [KB-06 L92] Ctrl+K — Command palette
- [KB-03 L98] Ctrl+Shift+R -- Resume from history
- [KB-11 L104] Ctrl+Shift+F — Open cross-session terminal search panel (side panel). Escape closes the panel.
- [KB-07 L110] Ctrl+, — Open Config Manager
- [KB-09 L125] Escape handling in useKeyboardShortcuts unwinds transient UI before sending ESC to the terminal, in this order: close tab context menu; if the command palette is open, return and let the palette own Escape; close changelog request; close ContextViewer; dispatch CONFIG_MANAGER_CLOSE_REQUEST_EVENT for ConfigManager; close ResumePicker; close SessionLauncher; clear inspectedSubagent; blur any focused non-xterm element and refocus the active terminal on the next animation frame; otherwise write \x1b to the active PTY.
- [KB-04 L150] Ctrl+Tab / Ctrl+Shift+Tab — Cycle tabs
- [KB-05 L157] Alt+1-9 — Jump to tab N

## Session Launcher

- [SL-01 L79] SessionLauncher opens for new, resume, or fork launches; Ctrl+Shift+N opens a fresh launcher and clearOneShotLauncherFields strips resumeSession, forkSession, and continueSession from lastConfig before showing it.
  - SessionLauncher renders Fork Session/Forking from when config.resumeSession && config.forkSession. The same clearOneShotLauncherFields helper is used by keyboard, App, and CommandPalette fresh-launch paths so one-shot resume/fork/continue state does not leak into a new session.
