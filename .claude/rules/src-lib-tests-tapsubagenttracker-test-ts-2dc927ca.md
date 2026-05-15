---
paths:
  - "src/lib/__tests__/tapSubagentTracker.test.ts"
---

# src/lib/__tests__/tapSubagentTracker.test.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Inspector Tap Pipeline

- [IN-26 L435] Subagent tool event routing: tapSubagentTracker routes ToolCallStart, ToolInput, and TurnEnd events to the active subagent when sidechainActive is true. ToolCallStart updates currentToolName and currentEventKind. ToolInput updates currentAction and also enriches the last tool message with structured toolInput data (new object reference for React.memo). TurnEnd(end_turn) transitions the agent state to 'idle' and clears currentToolName/currentAction/currentEventKind. Non-noisy event kinds also routed to active subagent in default case. Active-state guard (isSubagentActive) prevents routing to dead/idle subagents.
