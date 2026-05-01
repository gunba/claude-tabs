---
paths:
  - "src/lib/sessionRelaunch.ts"
---

# src/lib/sessionRelaunch.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Respawn & Resume

- [RS-08 L21] Dead-tab relaunch resolves a Claude resume id from same-directory JSONL past sessions; Codex sessions short-circuit and reuse their captured rollout id from getResumeId(). Forked Claude tabs prefer their current sessionId before the parent resumeSession.
  - resolveResumeId() in src/lib/claudeResume.ts early-returns null when session.config.cli !== 'claude' so a dead Codex tab never gets respawned with a Claude UUID. For Claude sessions it canonicalizes cwd, filters same-directory non-Codex past sessions, prefers exact stored id, returns the single candidate, otherwise picks closest lastModified to lastActive/createdAt. For forkSession tabs, getResumeId()/resolveResumeId() prefer config.sessionId over config.resumeSession so relaunching an existing fork continues the fork. relaunchDeadSession (src/lib/sessionRelaunch.ts) consumes resolvedId ?? getResumeId(session), clears forkSession and continueSession, strips worktree flags, preserves launchWorkingDir, inserts the replacement at the old index, and closes the dead tab only after createSession succeeds. Regression test: src/lib/__tests__/claude.test.ts "returns null for Codex sessions so a dead Codex tab never gets respawned with a Claude UUID".
