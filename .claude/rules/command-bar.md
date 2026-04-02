---
paths:
  - "src/components/CommandBar/**"
---

# Command Bar

<!-- Codes: CB=Command Bar -->

- [CB-01] Slash command pills sorted by usage frequency, then alphabetically
- [CB-02] Heat gradient: pills show 5-tier WoW rarity heat (uncommon green → rare blue → epic purple → legendary orange) based on usage relative to most-used command. Superseded by CB-12 CSS class system — no longer uses inline styles.
- [CB-03] History bootstrap: on each launch, scans up to 200 recent JSONL files for slash command usage so heat map stays warm
- [CB-04] Click a pill types the command into the terminal without sending; Ctrl+Click sends immediately
- [CB-05] Ctrl+Click a pill sends the command to the PTY immediately (records usage on send)
- [CB-07] Holding Ctrl shows blue border on pills; heat gradient suppressed while Ctrl is held
- [CB-09] Command history strip: horizontal scrollable row above command pills showing per-session command execution history (newest left). Clicking a history pill re-sends that command. Strip only visible when history exists. Per-session -- switching tabs shows different history. Cleaned up on session close.
  - Files: src/components/CommandBar/CommandBar.tsx, src/store/sessions.ts
- [CB-10] Heat gradient uses CSS classes (heat-1, heat-2, heat-3) instead of inline styles. heatClassName() returns class name, computeHeatLevel() returns 0-3 level. Colors: blue (low/accent-secondary) → purple (mid/accent-tertiary) → clay (high/accent). Applied in both CommandBar and SessionLauncher command pills.
  - Files: src/lib/claude.ts, src/components/CommandBar/CommandBar.tsx, src/components/CommandBar/CommandBar.css, src/components/SessionLauncher/SessionLauncher.tsx, src/components/SessionLauncher/SessionLauncher.css
- [CB-11] Command bar layout: history strip always visible; toggle chevron shows/hides the slash-command grid only (not history). Previously, collapsing hid both history and commands.
  - Files: src/components/CommandBar/CommandBar.tsx, src/components/CommandBar/CommandBar.css
- [CB-12] Heat gradient expanded to 5-tier WoW rarity scale (heat-0 through heat-4): uncommon (green), rare (blue), epic (purple), legendary (orange). computeHeatLevel() in claude.ts uses thresholds 0.20, 0.50, 0.80. CSS classes use color-mix() with rarity CSS variables (--rarity-uncommon/rare/epic/legendary) defined in theme.ts. Replaces previous 4-tier inline-style heat system.
  - Files: src/lib/claude.ts, src/components/CommandBar/CommandBar.css, src/components/SessionLauncher/SessionLauncher.css, src/lib/theme.ts
- [CB-13] Skill invocation pills live in CommandBar (not agent bar): SkillInvocation results are shown as pills in a .skill-pills-row strip at the top of CommandBar, above the chevron toggle. Read directly from store (skillInvocations map). Dismissed individually via removeSkillInvocation. Pills show /skill-name with success/failure coloring.
  - Files: src/components/CommandBar/CommandBar.tsx, src/App.tsx
