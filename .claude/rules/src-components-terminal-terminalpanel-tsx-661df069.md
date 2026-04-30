---
paths:
  - "src/components/Terminal/TerminalPanel.tsx"
---

# src/components/Terminal/TerminalPanel.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Activity Store Semantics

- [AS-05 L100] useUserTurnListener subscribes to user-turn-started-{sessionId} (Tauri event emitted by the proxy when /v1/messages, /v1/responses, or /backend-api/codex/responses is classified as a fresh user turn) and calls useActivityStore.markUserMessage(sid). This drives lastUserMessageAt, which the response-mode ActivityPanel uses as the timestamp boundary that hides files from prior turns. Mounted in TerminalPanel alongside useTapEventProcessor with the same dead-session gate. Classifier logic lives in src-tauri/src/proxy/mod.rs:classify_user_turn — last-message inspection: Anthropic uses messages[].role + content (string or array of text/tool_result blocks); OpenAI Responses uses input[].type ('message'+role=user vs function_call_output/tool_result); count_tokens always Other. Replaces the queue-time UserInput/SlashCommand trigger that prematurely cleared the panel for queued-then-erased messages (see AS-01).
  - Listener: src/hooks/useUserTurnListener.ts:L10. Mount: src/components/Terminal/TerminalPanel.tsx:L100 (alongside useTapEventProcessor at L95). Classifier: src-tauri/src/proxy/mod.rs:L1334 (UserTurnKind enum), L1340 (classify_user_turn), L1373 (classify_anthropic_messages), L1416 (classify_openai_responses). Emit site: src-tauri/src/proxy/mod.rs:L744 (in handle_connection, after resolve_upstream succeeds, before rewrite_body_for_upstream). Tests: src/hooks/__tests__/useUserTurnListener.test.ts (6 cases) + 14 classify_user_turn_* tests in proxy/mod.rs.

## Terminal UI

- [TA-13 L33] TerminalPanel is wrapped in React.memo with terminalPanelPropsEqual comparing prev/next on visible, session.id, session.state, session.name, session.config (reference), session.metadata.nodeSummary, and session.metadata.assistantMessageCount. Other Session metadata fields don't trigger a re-render — TerminalPanel only depends on these for its rendered output. Prevents tap-event-driven metadata churn from re-rendering the heavy terminal subtree.
  - src/components/Terminal/TerminalPanel.tsx:L29 (terminalPanelPropsEqual); src/components/Terminal/TerminalPanel.tsx:L106 (memo wrap); src/components/Terminal/TerminalPanel.tsx:L762 (export memo with comparator).
- [TR-05 L207] Hidden tabs use CSS display: none -- never unmount/remount xterm.js (destroys state).
