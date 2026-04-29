---
paths:
  - "src/lib/terminalKeyShortcuts.ts"
---

# src/lib/terminalKeyShortcuts.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Keyboard Shortcuts

- [KB-10 L78] Alt+1-9 blocked from PTY (return false in attachCustomKeyEventHandler) -- handled by App.tsx global tab-switch handler without escape code artifacts

## Terminal Scroll

- [TR-03 L74] Ctrl+Home scrolls to top, Ctrl+End scrolls to bottom. Handled in useTerminal's attachCustomKeyEventHandler.

## Terminal UI

- [TA-12 L26] getTerminalKeySequenceOverride (useTerminal.ts): intercepts Shift+Enter (keydown, key='Enter', shiftKey=true, no Ctrl/Alt/Meta) and returns kitty-protocol sequence \x1b[13;2u (SHIFT_ENTER_SEQUENCE constant). The xterm.js custom key handler calls onData with the sequence and returns false to prevent xterm's default Enter handling. Allows Claude Code to distinguish Shift+Enter from bare Enter for multi-line input.
