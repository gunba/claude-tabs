---
paths:
  - "src/components/NotesPanel/NotesPanel.tsx"
---

# src/components/NotesPanel/NotesPanel.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Notes Panel

- [NP-01 L8] NotesPanel component provides per-session scratchpad with Conversation/Project subtabs. Conversation notes stored in session.metadata.notes (in-memory, per-tab). Project notes stored in workspaceNotes[wsKey] in settings store (persisted, keyed by lowercased normalized project root, worktree paths collapsed). Send-all and Send-selected buttons write note text to the active session PTY via writeToPty (appending CRLF). Buffer is NOT cleared after send. Subtab switching and tab switching clear the hasSelection state. source: src/components/NotesPanel/NotesPanel.tsx:L1
