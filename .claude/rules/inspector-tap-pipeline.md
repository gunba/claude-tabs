---
paths:
  - "src/lib/tapClassifier.ts"
  - "src/lib/tapSubagentTracker.ts"
  - "src/hooks/useTapPipeline.ts"
  - "src/components/SubagentInspector/**"
---

# Inspector Tap Pipeline

<!-- Codes: SI=State Inspection, IN=Inspector -->

- [SI-09] Subagent descriptions, state, tokens, actions, and messages all captured via inspector tap events (no JSONL subagent watcher). No JSONL file watching for state -- Rust JSONL utilities kept only for `session_has_conversation` and `list_past_sessions`.
  - Files: src/lib/tapSubagentTracker.ts

- [IN-03] Subagent tracking: inspector detects Agent tool_use -> queues description in pendingDescs -> first sidechain ConversationMessage with new agentId creates subagent entry, pops description. Routing is direct via agentId field on events.
  - Files: src/lib/tapSubagentTracker.ts

- [IN-04] Subagent conversation messages captured via tapSubagentTracker.ts processing ConversationMessage events with isSidechain:true and agentId routing. Tool message text strips tool name prefix (e.g. 'Read: path' -> 'path') since the blue toolName label renders it separately in SubagentInspector. Token + cost attribution via lastActiveAgent tracking + queryDepth>0 from ApiTelemetry. SubagentLifecycle events enrich with agentType, isAsync, model, totalToolUses, durationMs. SubagentNotification marks ALL active subagents dead (no break). Late sidechain ConversationMessage events gated: if agent state is already idle/dead (checked via isSubagentActive), event is ignored.
  - Files: src/lib/tapSubagentTracker.ts

- [IN-05] Stale subagent detection removed -- push-based architecture handles subagent lifecycle via real-time state events only
  - Files: src/lib/tapSubagentTracker.ts

- [IN-06] Dead subagent purge removed -- push-based architecture relies on real-time state transitions; idle subs remain visible until session ends
  - Files: src/lib/tapSubagentTracker.ts

- [IN-08] SubagentInspector tool block collapse: MessageBlock wrapped in React.memo to prevent re-rendering unchanged messages (ReactMarkdown is expensive). Uses local useState for collapsed state; getToolPreview extracts first non-empty line (120 char cap). Parent computes lastToolIndex via reduce; only the last tool message auto-expands when subagent is active (not dead/idle). React key={i} ensures stable mounting.
  - Files: src/components/SubagentInspector/SubagentInspector.tsx

- [IN-10] Tap event pipeline: raw entries arrive via TCP socket (TAP_PORT) -> tapClassifier.ts classifies ~49 typed events -> tapEventBus.ts dispatches per-session -> tapStateReducer.ts (state), tapMetadataAccumulator.ts (metadata), tapSubagentTracker.ts (subagents) -> store actions.

- [IN-15] AccountInfo classifier fix: guard relaxed from requiring subscriptionType to requiring only billingType (newer CLI omits subscriptionType). subscriptionType extracted with fallback to null.
  - Files: src/lib/tapClassifier.ts

- [IN-16] Subagent costUsd tracking: TapSubagentTracker accumulates costUSD from ApiTelemetry events (queryDepth > 0) into per-agent subagentCost Map. Pushed to store alongside tokenCount. Subagent type extended with optional costUsd field.
  - Files: src/lib/tapSubagentTracker.ts, src/types/session.ts

- [IN-17] SkillInvocation event: classifier detects user-type messages with toolUseResult.commandName and returns SkillInvocation kind (skill name, success, allowedTools). Early-return before UserInterruption/PermissionRejected checks prevents misclassification. useTapEventProcessor stores invocations via addSkillInvocation store action.
  - Files: src/lib/tapClassifier.ts, src/hooks/useTapEventProcessor.ts, src/types/tapEvents.ts, src/store/sessions.ts
- [IN-18] HttpPing event: cat=ping tap entries classified to HttpPing (durationMs, status). tapMetadataAccumulator stores durationMs as apiLatencyMs exclusively from these events — ApiFetch no longer contributes latency (ApiFetch RTT includes CF edge cache hits which can return <5ms, making it misleading).
  - Files: src/lib/tapClassifier.ts, src/lib/tapMetadataAccumulator.ts, src/types/tapEvents.ts
