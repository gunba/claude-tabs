---
paths:
  - "src/lib/claudeResume.ts"
---

# src/lib/claudeResume.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Respawn & Resume

- [RS-02 L13] Resume target chain: `resumeSession || sessionId || id` (chains through multiple respawns)
- [RS-08 L20] Dead-tab relaunch resolves a Claude resume id from same-directory JSONL past sessions; Codex sessions short-circuit and reuse their captured rollout id from getResumeId(). Forked Claude tabs prefer their current sessionId before the parent resumeSession.
  - resolveResumeId() in src/lib/claudeResume.ts early-returns null when session.config.cli !== 'claude' so a dead Codex tab never gets respawned with a Claude UUID. For Claude sessions it canonicalizes cwd, filters same-directory non-Codex past sessions, prefers exact stored id, returns the single candidate, otherwise picks closest lastModified to lastActive/createdAt. For forkSession tabs, getResumeId()/resolveResumeId() prefer config.sessionId over config.resumeSession so relaunching an existing fork continues the fork. relaunchDeadSession (src/lib/sessionRelaunch.ts) consumes resolvedId ?? getResumeId(session), clears forkSession and continueSession, strips worktree flags, preserves launchWorkingDir, inserts the replacement at the old index, and closes the dead tab only after createSession succeeds. Regression test: src/lib/__tests__/claude.test.ts "returns null for Codex sessions so a dead Codex tab never gets respawned with a Claude UUID".
- [RS-03 L71] Check conversation existence via resumeSession || nodeSummary || assistantMessageCount > 0 (in-memory, no JSONL). canResumeSession() in claude.ts returns true when any of these three conditions holds: config.resumeSession is set, metadata.nodeSummary is present, or metadata.assistantMessageCount > 0.

## Dead Session Handling

- [DS-03 L70] Auto-resume and fork affordances are guarded by canResumeSession(), which requires actual conversation evidence: resumeSession, nodeSummary, or assistantMessageCount; sessionId alone is not enough.
  - Source: src/lib/claudeResume.ts canResumeSession(). This is intentionally in-memory evidence only; no JSONL scan runs from the guard.

## Session Resume

- [SR-08 L91] Worktree flag stripping on resume/respawn removes -w/--worktree, optional following worktree names, and --worktree=<name> via shell-quote parsing.
  - stripWorktreeFlags() in src/lib/claudeResume.ts preserves unrelated flags and returns null when no tokens remain. This prevents resume/respawn from requesting a duplicate or explicitly named worktree while the session resumes in its existing workingDir.
