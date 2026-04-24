---
paths:
  - "src/components/CommandBar/CommandBar.tsx"
---

# src/components/CommandBar/CommandBar.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Command Bar

- [CB-01 L46] Slash command pills sorted by usage frequency, then alphabetically
- [CB-05 L65] Ctrl+Click a pill sends the command to the PTY immediately (records usage on send)
- [CB-04 L68] Click a pill types the command into the terminal without sending; Ctrl+Click sends immediately
- [CB-11 L103] Command bar layout: history strip always visible; toggle chevron shows/hides the slash-command grid only (not history). Previously, collapsing hid both history and commands.
- [CB-09 L131] Command history strip: horizontal scrollable row above command pills showing per-session command execution history (newest left). Clicking a history pill re-sends that command. Strip only visible when history exists. Per-session -- switching tabs shows different history. Cleaned up on session close.
