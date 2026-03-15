# Claude Tabs — Testing Protocol

## Automated Tests

```bash
npm test           # Run once
npm run test:watch # Watch mode
```

55 tests across 5 files. Tests cover: state detection patterns, ANSI stripping, metadata extraction, context warning detection, theme structure, CLI arg helpers, dagre graph layout, meta-agent utilities.

Test files:
- `src/lib/__tests__/stateDetector.test.ts` — 27 tests for state detection, ANSI stripping, metadata extraction, context warnings
- `src/lib/__tests__/graphLayout.test.ts` — 10 tests for dagre graph layout, node positioning, edge creation, empty graph handling
- `src/lib/__tests__/claude.test.ts` — 9 tests for CLI helpers (`dirToTabName`, `modelLabel`)
- `src/lib/__tests__/metaAgent.test.ts` — 5 tests for `sessionFingerprint` utility (change detection, stability)
- `src/lib/__tests__/theme.test.ts` — 4 tests for theme structure validation, color role completeness

## Manual Test Checklist

Run after any significant UI or behavior change.

### Launch & Session Creation
- [ ] Launch app — empty state shows with "New Session" button
- [ ] Click "New Session" or Ctrl+T — launcher opens
- [ ] Type a valid directory path — Enter launches Claude Code in terminal
- [ ] Claude Code starts and shows its prompt (not stuck on "Starting")
- [ ] Invalid path — error shown in terminal panel
- [ ] Recent directories appear as clickable cards after first session
- [ ] Model selection icons work — tooltip on hover
- [ ] Permission mode icons work — tooltip on hover
- [ ] Esc closes launcher

### Graph Canvas
- [ ] Canvas shows with architect paper background
- [ ] Create session — node appears on canvas
- [ ] Click node — terminal opens as overlay
- [ ] Escape — terminal overlay dismisses, canvas visible again
- [ ] Create multiple sessions — dagre arranges nodes automatically
- [ ] Haiku meta-agent node visible (if metaAgentEnabled)
- [ ] Node summaries update on session nodes
- [ ] Close session — node removed from canvas
- [ ] Ctrl+Tab / Ctrl+Shift+Tab — cycles sessions
- [ ] Ctrl+1-9 — jumps to session N
- [ ] Ctrl+W — closes active session

### State Detection
- [ ] Type a prompt — state icon changes to thinking (pulsing)
- [ ] Tool use — state icon shows gear (spinning)
- [ ] Permission prompt — state icon shows pause (pulsing orange)
- [ ] Idle after response — state icon shows checkmark
- [ ] State banner (top-right of terminal) matches tab icon
- [ ] Banner shows tool name during tool use (e.g., "Bash")

### Status Bar
- [ ] Model name shown (icon-only for permission mode)
- [ ] Context % updates during conversation
- [ ] Cost updates after responses
- [ ] Duration timer ticks live
- [ ] Active session count with pulsing dot
- [ ] Total session count shown

### Command Palette
- [ ] Ctrl+K opens palette
- [ ] Search filters tabs and commands
- [ ] Arrow keys + Enter navigate and select
- [ ] Esc closes palette

### Theme
- [ ] App has warm dark background (Cowork bg-200 #1f1e1c, not blue/cold)
- [ ] Accent color is Cowork clay (#d4744a, warm orange)
- [ ] Terminal text is warm white (#f9f7f3), not blue-white
- [ ] All UI elements use CSS custom properties (no hardcoded hex)
- [ ] `--bg-hover` and `--accent-tertiary` variables are defined

### Persistence
- [ ] Close and reopen app — previous sessions shown as Dead
- [ ] Recent directories persist across restarts
- [ ] Presets persist across restarts
- [ ] Last model/permission mode selection preserved

### Shannon Panel (Meta-Agent)
- [ ] Shannon panel visible on the right side (340px)
- [ ] Panel collapses and expands correctly
- [ ] Typing a message and sending shows user bubble + assistant response
- [ ] Haiku summaries appear as centered system badges in the panel
- [ ] Haiku triggers on session state transitions (thinking/toolUse to idle)
- [ ] Shannon does not steal focus from active terminal
- [ ] Session nodes display `nodeSummary` text from Haiku
- [ ] Control bridge commands work (create-session, close-session, etc.)
- [ ] CLI version change triggers alert in Shannon system prompt
