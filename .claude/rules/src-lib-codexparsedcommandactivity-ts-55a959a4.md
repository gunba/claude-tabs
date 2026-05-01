---
paths:
  - "src/lib/codexParsedCommandActivity.ts"
---

# src/lib/codexParsedCommandActivity.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Codex File Activity
Codex-derived file activity from apply_patch and parsed exec command telemetry.

- [CP-02 L22] codexParsedCommandActivities maps Codex exec_command_end parsed_cmd records into activity entries: read -> kind=read/isFolder=false, list_files and search -> kind=searched/isFolder=true, relative paths resolve against the command cwd, absolute/tilde/drive-letter paths are canonicalized directly, and unknown parsed command types are ignored. tapActivityTracker consumes CodexToolCallComplete.parsedCmd with event.cwd falling back to the session workingDir and writes those operations through activityStore.addFileActivity with the normalized Codex tool name.
  - This path uses Codex's structured parsed_cmd telemetry instead of re-tokenizing shell strings for command types Codex already recognized. The helper is covered by src/lib/__tests__/codexParsedCommandActivity.test.ts.
