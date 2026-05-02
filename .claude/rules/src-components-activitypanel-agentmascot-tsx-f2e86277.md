---
paths:
  - "src/components/ActivityPanel/AgentMascot.tsx"
---

# src/components/ActivityPanel/AgentMascot.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Activity Panel

- [AP-04 L37] ActivityPanel shows a floating/sticky mascot that travels to the file currently being accessed by the main agent. The mascot is provider-aware (cli prop drives MASCOT_SRC: claude-mascot.png or codex-mascot.png). Animations: reading/writing/searching rock, moving hops, idle subtly bobs. Mascot animation is suppressed on tab switch via StickyMascot.tabId. Subagent files show inline AgentTypeIcon indicators at their last-touched files while active, and completed subagents remain dimmed at their last-touched files. Subagent indicators share .agent-mascot-img animation/overlay behavior; .agent-mascot-icon defaults to var(--cli-claude) and .agent-mascot-cli-codex overrides it to var(--cli-codex). Tree indentation uses INDENT_STEP=16px.
