---
paths:
  - "src/lib/sessionRelaunch.ts"
---

# src/lib/sessionRelaunch.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Respawn & Resume

- [RS-08 L21] Dead Claude tab relaunch auto-resolves a valid resume id from listed JSONL past sessions before falling back to the stored resume chain. resolveResumeId canonicalizes the dead tab working directory, filters same-directory non-Codex past sessions, prefers an exact stored resumeSession/sessionId match when that JSONL exists, returns the single candidate directly, and otherwise picks the candidate whose lastModified is closest to the tab lastActive/createdAt with the Rust-provided newest-first order as fallback. relaunchDeadSession uses that resolved id, preserves the launch working directory, clears continueSession, strips worktree flags, creates the replacement tab at the old index when possible, and closes the dead tab only after createSession succeeds.
