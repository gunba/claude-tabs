---
paths:
  - "src/lib/codexSubagentMessages.ts"
---

# src/lib/codexSubagentMessages.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Inspector Tap Pipeline

- [IN-35 L4] Codex subagent parity path: TapSubagentTracker creates/updates subagent cards directly from CodexSubagentSpawned and CodexSubagentStatus events, maps Codex statuses pending_init/running/interrupted/completed/errored/shutdown/not_found to SessionState, stores nickname/role/model/prompt metadata, marks completed statuses dead with result text, and downgrades still-active Codex child cards to idle on parent CodexTaskComplete to avoid permanently active cards when no later child status arrives. SubagentInspector recognizes Codex thread ids, invokes read_codex_thread_inspector, converts captured Codex tool calls/results/text into SubagentMessage blocks, and updates the store when the loaded child rollout reports completion.
  - Codex child rollouts are loaded on inspector open; this entry does not claim continuous child-rollout tailing into the subagent bar.
