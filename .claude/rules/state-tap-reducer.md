---
paths:
  - "src/lib/tapStateReducer.ts"
  - "src/hooks/useTapEventProcessor.ts"
  - "src/App.tsx"
---

# State Tap Reducer

<!-- Codes: SI=State Inspection, IN=Inspector -->

- [SI-03] reduceTapEvent() / reduceTapBatch() -- pure state reducer: (SessionState, TapEvent) -> SessionState. Event-driven, no polling, no terminal buffer fallback.
  - Files: src/lib/tapStateReducer.ts

- [SI-04] Permission detection via `PermissionPromptShown` tap event (not PTY regex). tapStateReducer transitions to waitingPermission; permPending flag still exists in INSTALL_HOOK state but is no longer polled.
  - Files: src/lib/tapStateReducer.ts

- [SI-08] State is NEVER inferred from timers or arbitrary delays -- only from real signals
  - Files: src/lib/tapStateReducer.ts

- [SI-13] tapStateReducer event priority: actionNeeded is a sticky state preserved by an early-return guard at the top of reduceTapEvent -- only UserInput, SlashCommand, UserInterruption, PermissionPromptShown, ConversationMessage(user, non-sidechain), IdlePrompt, and ToolResult(AskUserQuestion/ExitPlanMode) or TurnStart can clear it. ExitPlanMode tool call -> actionNeeded; PermissionPromptShown -> waitingPermission (always wins via reduceTapBatch); UserInterruption -> interrupted; TurnEnd(end_turn) -> idle; TurnEnd(tool_use) -> toolUse; IdlePrompt -> idle (authoritative).
  - Files: src/lib/tapStateReducer.ts, src/hooks/useTapEventProcessor.ts

- [SI-19] Terminal buffer prompt fallback removed: tap event pipeline is push-based; idle detection via TurnEnd/ConversationMessage events. `promptDetected` field retained in POLL_STATE for backward compatibility but not consumed.
  - Files: src/lib/tapStateReducer.ts

- [SI-20] Worktree cwd detection: when tap events (ConversationMessage, SessionRegistration, WorktreeState) carry a cwd or worktreePath, useTapEventProcessor updates the session's workingDir via updateConfig. WorktreeCleared restores originalCwd. Fires only on change (normalizePath comparison).
  - Files: src/hooks/useTapEventProcessor.ts

- [SI-23] Plan detection relies solely on `ToolCallStart(ExitPlanMode)` -> `actionNeeded`. ToolCallStart fires during the SSE stream, structurally before any UserInput can arrive. actionNeeded is sticky: only UserInput, SlashCommand, UserInterruption, PermissionPromptShown, ToolResult(AskUserQuestion/ExitPlanMode), or TurnStart can clear it.
  - Files: src/lib/tapStateReducer.ts, src/hooks/useTapEventProcessor.ts

- [SI-24] Tab flash debounce (2s): flash notifications for idle state changes are debounced with a 2-second timer. Pending flashes are cancelled when the session goes non-idle again, preventing false alerts during transient idle windows.
  - Files: src/App.tsx

- [IN-13] SessionState 'interrupted' added: UserInterruption transitions to interrupted (not idle). Visually distinct (red dot, no pulse) but functionally equivalent to idle via isSessionIdle() helper. Auto-clears to thinking on next UserInput/ConversationMessage. clearIdleSubagents also clears interrupted.
  - Files: src/types/session.ts, src/lib/tapStateReducer.ts, src/store/sessions.ts
