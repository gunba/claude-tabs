---
paths:
  - "src/store/activity.ts"
---

# src/store/activity.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Activity Panel

- [AP-03 L165] activity store kind precedence: when addFileActivity() is called for a path already recorded in the current turn or allFiles, 'created' is never downgraded to 'modified'. If existing kind is 'created' and new kind is 'modified', the entry keeps 'created'. This prevents a subsequent Edit/Write call from masking the original creation event.
