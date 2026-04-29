---
paths:
  - "src/hooks/useNotifications.ts"
---

# src/hooks/useNotifications.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Window

- [WN-03 L25] [WN-03] Desktop notifications fire for background sessions when a response completes, permission is needed, or an error state settles. useNotifications skips the active tab and meta agents, rate-limits to one notification per session per 30s, invokes the Rust send_notification bridge, and listens for notification-clicked to switch to the target tab and focus the window. The Rust bridge uses WinRT Toast activation callbacks on Windows and notify-rust default actions on Linux; other platforms fall back to basic Tauri notifications without click-to-switch.
- [WN-04 L102] When a background-session notification fires while the main window is unfocused, `useNotifications` flashes the OS taskbar/user-attention indicator via `requestUserAttention(UserAttentionType.Informational)`. This path depends on `core:window:allow-request-user-attention` in `src-tauri/capabilities/default.json`.

## Development Rules

- [DR-08 L103] Use `dlog(module, sessionId, message, level?)` from `src/lib/debugLog.ts` for all application logging. Never use raw `console.log/warn/error`. Module names: `pty`, `inspector`, `terminal`, `session`, `config`, `launcher`, `resume`, `tap`, `proxy`, `notify`. Pass `sessionId` when in scope, `null` otherwise. Use `"DEBUG"` level for verbose tracing, `"WARN"`/`"ERR"` for problems.
