---
paths:
  - "src/components/SubagentBar/SubagentBar.tsx"
---

# src/components/SubagentBar/SubagentBar.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Terminal UI

- [TA-06 L41] Subagent activity display in SubagentBar uses getActivityText() and getActivityColor() with getNoisyEventKinds(activeProvider) to derive the compact status row from currentEventKind/currentToolName. The card falls back to Completed or the subagent state when no activity text exists, appends tool count, duration, and token totals when present, and shows AgentTypeIcon for subagentType || agentType. It no longer reuses the parent tab's .tab-activity CSS; the status text is rendered inside .subagent-status-row with an inline color from getActivityColor().
