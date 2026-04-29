---
paths:
  - "src/hooks/useSessionPersistence.ts"
---

# src/hooks/useSessionPersistence.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Persistence

- [PS-03 L13] Debounced auto-persist every 2s on session array changes
- [PS-02 L20] `beforeunload` event flushes sessions so they survive app restart
- [PS-04 L20] `beforeunload` kills all active PTY process trees before persisting — prevents orphaned CLI processes holding session locks on restart
