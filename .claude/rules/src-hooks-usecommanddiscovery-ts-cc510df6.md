---
paths:
  - "src/hooks/useCommandDiscovery.ts"
---

# src/hooks/useCommandDiscovery.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Per-CLI Command Discovery

- [PI-01 L22] useCommandDiscovery emits per-CLI palettes via setSlashCommandsForCli('claude'|'codex'). Claude-side discovery (builtin+plugin+help) is gated on claudePath being non-null. Codex-side discovery (discover_codex_slash_commands + discover_codex_skills) is gated on codexPath being non-null. Both sides call setSlashCommandsForCli which rebuilds the merged slashCommands list. Claude builtin scan falls back to --help regex when binary scan fails. Discovery fires once per ready signal (no setTimeout): the ready Zustand selector gates on either claudePath/codexPath being set AND every session being dead OR at least one session past 'starting'; the previous 3000ms setTimeout was dropped in c1745be.
