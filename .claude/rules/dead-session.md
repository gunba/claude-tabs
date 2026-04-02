---
paths:
  - "src/components/Terminal/TerminalPanel.tsx"
  - "src/store/sessions.ts"
  - "src/lib/claude.ts"
  - "src/App.tsx"
---

# Dead Session Handling

- [DS-01] When a session dies, handlePtyExit switches to the nearest live tab via `findNearestLiveTab`. No overlay is shown (external holder overlay excepted). Dead tabs stay in the tab bar at reduced opacity.
  - Files: src/components/Terminal/TerminalPanel.tsx, src/lib/claude.ts
- [DS-02] All respawn actions reuse the same tab — no new tab created, no old tab destroyed
- [DS-03] Auto-resume guarded by `canResumeSession()` (derived from `sessionId`, `resumeSession`, or `nodeSummary` — no JSONL check)
  - Files: src/lib/claude.ts
- [DS-05] Ctrl+Shift+R opens resume picker from any state; ResumePicker detects active dead tab and respawns in place via requestRespawn
- [DS-06] ResumePicker detects active dead tab and respawns in place instead of creating new session
- [DS-07] Session-in-use auto-recovery: own orphans killed automatically and resume retries; external processes show "Session in use externally" overlay with "Kill and resume" / "Cancel" — never killed without user confirmation
- [DS-08] Proactive orphan cleanup on startup: init() collects all persisted session IDs, calls kill_orphan_sessions to kill leftover CLI processes before any PTY spawning. Prevents 'session ID already in use' and port conflicts on app restart after crash/force-close
  - Files: src/store/sessions.ts
- [DS-09] Auto-resume: clicking a dead tab makes it visible, triggering respawn on hidden-to-visible transition if conversation is resumable. When a session dies while visible, handlePtyExit switches away (hiding the tab), so clicking it later triggers this effect.
  - Files: src/components/Terminal/TerminalPanel.tsx
- [DS-10] Ctrl+Tab skips dead tabs (filters to non-dead pool, falls back to full pool if all dead). Cycling to a dead tab in the fallback triggers auto-resume via visibility change if resumable.
  - Files: src/App.tsx
- [DS-11] Clicking an already-active dead tab triggers respawn via requestRespawn (edge case: only tab or all tabs dead). Guarded by canResumeSession.
  - Files: src/App.tsx
- [DS-12] Tab selection on close (`closeSession`) uses `findNearestLiveTab` to prefer non-dead tabs; falls back to dead if all remaining are dead
  - Files: src/store/sessions.ts, src/lib/claude.ts
