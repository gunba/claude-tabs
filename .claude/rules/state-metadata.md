---
paths:
  - "src/lib/tapMetadataAccumulator.ts"
  - "src/components/StatusBar/StatusBar.tsx"
  - "src/components/Terminal/TerminalPanel.tsx"
---

# State Metadata

<!-- Codes: SI=State Inspection, IN=Inspector -->

- [SI-06] `choiceHint` detection: ToolCallStart event with toolName=AskUserQuestion sets choiceHint in tapMetadataAccumulator. Clears on UserInput, SlashCommand, TurnEnd(end_turn), PermissionApproved, PermissionRejected, or ToolResult(AskUserQuestion). No terminal buffer scanning.
  - Files: src/lib/tapMetadataAccumulator.ts

- [SI-07] Tool actions, user prompts, assistant text, subagent descriptions captured inline via tapMetadataAccumulator processing ToolInput, ConversationMessage, and UserInput events.
  - Files: src/lib/tapMetadataAccumulator.ts

- [SI-22] Duration timer: sole source is client-side useDurationTimer (1s setInterval in TerminalPanel, accumulates active-state time). TAP accumulator does NOT emit durationSecs -- TurnDuration events fall through to default:null. Timer resets accumulatedRef and lastTickRef on respawnCounter change to prevent stale values after respawn.
  - Files: src/components/Terminal/TerminalPanel.tsx, src/lib/tapMetadataAccumulator.ts

- [SI-25] Status line data capture: INSTALL_TAPS stringify hook detects hook_event_name==='Status' and pushes flattened fields to dedicated 'status-line' category. tapClassifier classifies as StatusLineUpdate event. tapMetadataAccumulator stores as grouped nullable statusLine object on SessionMetadata (19 fields). tapStateReducer treats as informational (no state change). Data available via session.metadata.statusLine.
  - Files: src/lib/tapMetadataAccumulator.ts, src/lib/tapClassifier.ts, src/lib/tapStateReducer.ts, src/types/tapEvents.ts

- [IN-09] choiceHint detection via ToolCallStart event with toolName=AskUserQuestion in tapMetadataAccumulator.ts. Full question schema available from ToolInput event.
  - Files: src/lib/tapMetadataAccumulator.ts

- [IN-11] StatusBar enrichment from tap events: model + subscription tier + API region (cf-ray) + ping latency (dedicated HttpPing, shown as "Ping: Xms"), rate limit display, hook status, subprocess indicator, lines changed (+/-), API retry count, stream stall indicator, tool duration. StatusLineUpdate event fields surfaced: contextUsedPercent, currentInputTokens+currentOutputTokens total, fiveHourUsedPercent, sevenDayUsedPercent. apiLatencyMs sourced exclusively from HttpPing events (not ApiFetch).
  - Files: src/components/StatusBar/StatusBar.tsx, src/lib/tapMetadataAccumulator.ts, src/hooks/useTapEventProcessor.ts

- [IN-14] Model bleed fix: ApiTelemetry only updates runtimeModel when queryDepth===0, preventing subagent model (e.g. Haiku) from overwriting parent tab display. Subagent model tracked separately via tapSubagentTracker update action on ApiTelemetry with queryDepth>0.
  - Files: src/lib/tapMetadataAccumulator.ts, src/lib/tapSubagentTracker.ts
- [IN-19] System prompt capture: INSTALL_TAPS intercepts API request body and pushes 'system-prompt' category with text, model, msgCount, and blocks array. tapClassifier emits SystemPromptCapture event (maps wire cc to cacheControl). tapMetadataAccumulator stores capturedSystemPrompt (string) and capturedSystemBlocks (SystemPromptBlock[]) on SessionMetadata; blocks excluded from fingerprint to avoid serialization cost, tracked via blocksChanged flag. Both reset on respawn. StatusBar shows 'Context' button when capturedSystemPrompt is truthy; opens ContextViewer modal.
  - Files: src/lib/inspectorHooks.ts, src/lib/tapClassifier.ts, src/lib/tapMetadataAccumulator.ts, src/types/tapEvents.ts, src/types/session.ts, src/components/StatusBar/StatusBar.tsx
