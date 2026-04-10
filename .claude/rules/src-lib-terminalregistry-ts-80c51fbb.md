---
paths:
  - "src/lib/terminalRegistry.ts"
---

# src/lib/terminalRegistry.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Terminal UI

- [TR-16 L1] Cross-session terminal search panel (Ctrl+Shift+F): SearchPanel searches all active session terminal buffers with debounced queries (250ms). Case-sensitive and regex modes. Results grouped by session; clicking a result switches tab and scrolls to match via SearchAddon. Capped at 500 results. searchBuffers.ts provides pure search logic; terminalRegistry.ts manages SearchAddon + scrollToLine registration.
