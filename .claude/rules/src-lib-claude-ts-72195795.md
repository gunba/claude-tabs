---
paths:
  - "src/lib/claude.ts"
---

# src/lib/claude.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Command Bar

- [CB-12 L317] Heat gradient 5-tier WoW rarity scale heat-0..heat-4 (common=white, uncommon=green, rare=blue, epic=purple, legendary=orange). Tiers assigned by rank-based quartiles over used commands: unused commands get heat-0 (common/white). CSS classes use color-mix() with --rarity-* CSS variables defined in applyTheme(). source: src/components/CommandBar/CommandBar.css:L126; src/lib/claude.ts:L254; src/lib/theme.ts:L145
- [CB-10 L343] Heat gradient uses CSS classes heat-0..heat-4. heatClassName(level) returns 'heat-${level}'. computeHeatLevel(count, rank, totalUsed) returns 0-4: count<=0 or totalUsed<=0 -> 0 (common/white), totalUsed==1 -> 4, otherwise rank-based quartiles over used commands (rank/totalUsed-1 < 0.25 -> 4, < 0.50 -> 3, < 0.75 -> 2, else -> 1). source: src/lib/claude.ts:L254,L274

## Respawn & Resume

- [RS-02 L15] Resume target chain: `resumeSession || sessionId || id` (chains through multiple respawns)
- [RS-08 L21] Dead Claude tab relaunch auto-resolves a valid resume id from listed JSONL past sessions before falling back to the stored resume chain. resolveResumeId canonicalizes the dead tab working directory, filters same-directory non-Codex past sessions, prefers an exact stored resumeSession/sessionId match when that JSONL exists, returns the single candidate directly, and otherwise picks the candidate whose lastModified is closest to the tab lastActive/createdAt with the Rust-provided newest-first order as fallback. relaunchDeadSession uses that resolved id, preserves the launch working directory, clears continueSession, strips worktree flags, creates the replacement tab at the old index when possible, and closes the dead tab only after createSession succeeds.
- [RS-03 L83] Check conversation existence via resumeSession || nodeSummary || assistantMessageCount > 0 (in-memory, no JSONL). canResumeSession() in claude.ts returns true when any of these three conditions holds: config.resumeSession is set, metadata.nodeSummary is present, or metadata.assistantMessageCount > 0.

## Dead Session Handling

- [DS-03 L82] Auto-resume guarded by `canResumeSession()` (derived from `sessionId`, `resumeSession`, or `nodeSummary` — no JSONL check)

## Session Resume

- [SR-08 L103] Worktree flag stripping on resume: `-w` and `--worktree` flags are stripped from extraFlags via `stripWorktreeFlags()` when resuming or respawning a session. Prevents creating a duplicate worktree — the session resumes in the existing worktree directory (workingDir was updated by inspector cwd detection [SI-20]).

## Terminal UI

- [TA-01 L176] Tab activity display: getActivityText() prioritizes currentEventKind (raw TAP event identifiers like ToolCallStart, ThinkingStart) over currentToolName. EVENT_KIND_COLORS map and eventKindColor() provide phase-based coloring (tool lifecycle=purple, thinking=purple, text=yellow, turn=green, permissions=peach/green/pink, errors=red). TOOL_COLORS + toolCategoryColor() used as fallback. tapMetadataAccumulator uses minimal block list (ApiTelemetry, ProcessHealth, ApiFetch excluded). App.tsx renders .tab-activity span with eventKindColor; unknown events fall back to --text-muted.
