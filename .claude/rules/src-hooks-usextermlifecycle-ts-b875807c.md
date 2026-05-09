---
paths:
  - "src/hooks/useXtermLifecycle.ts"
---

# src/hooks/useXtermLifecycle.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Keyboard Shortcuts

- [KB-12 L311] Platform-gated paste blocker: capture-phase paste event listener calling preventDefault is installed on the xterm DOM element when IS_WINDOWS or IS_LINUX is true (extended from Windows-only). Windows: prevents Tauri permission-dialog double-paste. Linux: lets Ctrl+V send ^V to PTY so Claude Code runs its native wl-paste/xclip clipboard read for text and image paste. macOS left alone. Ctrl+Shift+V is cross-platform paste via clipboard.readText(). Ctrl+V on Linux returns true (passes to PTY as ^V) rather than reading clipboard directly.

## PTY Output

- [PT-06 L355] Fixed 1M scrollback buffer in useTerminal -- no dynamic resizing. Set via scrollback option on Terminal constructor.

## Data Flow

- [DF-10 L105] useTerminal.fit() calls FitAddon.fit() without a surrounding try/catch, so resize errors propagate to the caller rather than being silently swallowed. The outer traceSync wrapper still captures timing; exceptions escape it normally.
- [DF-06 L154] useTerminal creates the WebglAddon once on openTerminal when enableWebgl=true and keeps it alive for the terminal's lifetime (no longer torn down on tab hide). onContextLoss disposes the addon and falls back to the canvas renderer with no retry loop. cursorBlink is still flipped on visibility to avoid wasted draws while hidden.
- [DF-11 L209] Xterm addons loaded on terminal open (openTerminal): WebLinksAddon, pathLinkProvider, and Unicode11Addon loaded via try/catch after WebglAddon. WebLinksAddon takes a custom click handler: plain click invokes Tauri 'shell_open'; Ctrl/Cmd+click invokes 'reveal_in_file_manager'. Unicode11Addon sets term.unicode.activeVersion='11'. All three addons plus pathLinkDisposable are disposed in cleanup. SearchAddon was removed in 32af768 along with the @xterm/addon-search dependency; no in-terminal search UI is wired today. pathLinkProvider (src/lib/terminalPathLinks.ts) is a separate ILinkProvider registered via term.registerLinkProvider().

## Terminal UI

- [TA-10 L452] Auto-rename from OSC 0 is Claude-only: term.onTitleChange normalizes OSC titles with normalizeTerminalTitle (strips leading non-letter/digit chars such as spinners/bullets) and shouldApplyTerminalTitle rejects missing sessions, Codex sessions, empty titles, 'Code Tabs', titles starting with 'Claude Code', bare 'claude' (case-insensitive), and unchanged names. On a valid Claude title, the handler calls renameSession(sid, title) and setSessionName(getResumeId(session), title). Codex OSC titles are ignored so folder/process titles such as code_tabs cannot overwrite Codex LLM autorename. Windows uses process.title and does not fire this OSC 0 path.
