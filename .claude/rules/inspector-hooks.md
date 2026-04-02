---
paths:
  - "src/lib/inspectorHooks.ts"
---

# Inspector Hooks

<!-- Codes: SI=State Inspection, IN=Inspector -->

- [SI-01] Sole source: BUN_INSPECT WebSocket inspector via JSON.stringify interception (~2-6ms latency). INSTALL_TAPS wraps JSON.parse and JSON.stringify to intercept Claude Code's internal event serializations.
  - Files: src/lib/inspectorHooks.ts

- [SI-11] Sealed flag (`_sealed`) on result event prevents post-completion JSON.stringify re-serializations (JSONL persistence, hook dispatch) from overwriting `state.stop` back to `tool_use`; tokens/model still accumulate while sealed; cleared on user event.
  - Files: src/lib/inspectorHooks.ts

- [SI-12] idleDetected is sticky in INSTALL_HOOK state: set on idle_prompt notification, cleared only by user events. Retained in hook for POLL_STATE compatibility; idle state in the running app is now derived from TurnEnd(end_turn) tap events by tapStateReducer.
  - Files: src/lib/inspectorHooks.ts

- [SI-14] Push-based architecture: INSTALL_TAPS injects hooks via BUN_INSPECT WebSocket; events pushed via TCP to Rust tap server, forwarded as Tauri events to useTapPipeline. INSTALL_HOOK / POLL_STATE still exist in inspectorHooks.ts but are not used by the running app (retained for test coverage).
  - Files: src/lib/inspectorHooks.ts

- [SI-15] POLL_STATE expression fields (retained in inspectorHooks.ts for tests/legacy): n, sid, cost, model, stop, tools, inTok/outTok, events (ring buffer), permPending/idleDetected (notification flags), subs, inputBuf/inputTs, choiceHint, promptDetected, cwd. Not consumed by running app -- state now derives from tap events.
  - Files: src/lib/inspectorHooks.ts

- [SI-16] WebFetch domain blocklist bypass: intercepts require('https').request to return can_fetch:true for api.anthropic.com/api/web/domain_info, eliminating the 10s preflight. Axios in Bun uses the Node http adapter (not globalThis.fetch), so the hook targets the shared https module singleton. Present in both INSTALL_HOOK and INSTALL_TAPS.
  - Files: src/lib/inspectorHooks.ts

- [SI-17] Interrupt signal detection: Ctrl+C (\x03) and Escape (\x1b) on stdin emit a synthetic result event, set state to end_turn, clear permission/tool flags, and mark all subagents idle -- enabling immediate idle detection without waiting for Claude's actual response. Only in INSTALL_HOOK (stdin hook).
  - Files: src/lib/inspectorHooks.ts

- [SI-18] WebFetch timeout protection: two hooks prevent indefinite hangs. (1) globalThis.fetch wrapper applies 120s timeout to non-streaming Anthropic API calls (the summarization path via callSmallModel). (2) https.request hard timeout applies 90s wall clock to all non-bypassed external HTTPS requests (the axios HTTP GET path). Present in both INSTALL_HOOK and INSTALL_TAPS.
  - Files: src/lib/inspectorHooks.ts

- [SI-21] Tap hooks: INSTALL_TAPS expression for capturing raw internal traffic. 15 categories: parse, stringify, console, fs, spawn, fetch, exit, timer, stdout, stderr, require, bun, websocket, net, stream. TCP push-based delivery via Bun.connect to TAP_PORT. parse and stringify always on for state detection; other categories opt-in via flags.
  - Files: src/lib/inspectorHooks.ts

- [IN-02] INSTALL_TAPS JS expression in inspectorHooks.ts; wraps 15 function categories. TCP push-based delivery via Bun.connect to TAP_PORT. Status-line detection: stringify wrapper checks hook_event_name==='Status' and pushes flattened fields to dedicated 'status-line' category (bypasses 2000-char snap truncation). Also contains WebFetch domain bypass, HTTPS/fetch timeout patches, and wrapAfter() helper for post-call hooks.
  - Files: src/lib/inspectorHooks.ts
- [IN-20] Active HTTP ping loop: after first Anthropic POST, INSTALL_TAPS captures auth headers (x-api-key/Authorization) and starts a dedicated GET /v1/models ping every 30s using prevFetch (unwrapped, avoids generating ApiFetch tap events). Authenticated requests bypass Cloudflare cache (cf-cache-status: DYNAMIC), so latency reflects true round-trip to Anthropic origin. Emits cat=ping entries to tap server.
  - Files: src/lib/inspectorHooks.ts
