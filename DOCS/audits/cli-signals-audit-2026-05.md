# CLI Signals Audit — 2026-05

## Scope

Audit Claude Code (vendored snapshot dated 2026-04-01 at `/home/jordan/Desktop/Projects/claude_code/`) and Codex CLI (`/home/jordan/Desktop/Projects/codex-main/`) for runtime signals that Code Tabs does not yet ingest.

Code Tabs consumes signals through two paths:

1. **TAP events** — `INSTALL_TAPS` hooks `JSON.stringify`/`JSON.parse` over the BUN_INSPECT WebSocket (see `src/lib/inspectorHooks.ts`) and pushes serialised payloads over TCP to `tap_server.rs`. `tapClassifier.ts` then maps them onto the typed union in `src/types/tapEvents.ts`.
2. **Codex rollout watcher** — `src-tauri/src/observability/codex_rollout.rs` reads `~/.codex/sessions/.../rollout-*.jsonl` and emits synthetic `codex-*` tap entries.

This audit is grouped by the topic the user called out (subagents) and the cross-cutting domains (general stream signals, Codex, terminal/discovery). Recommendations are sized for a follow-up batch; this PR ships only the single highest-leverage fix.

---

## Part A — Subagent-related signals

### A1. `<task-notification>` XML is captured but truncated to two fields

**Status:** P1 (shipped in this PR).

`tapClassifier.classifyStringify` routes `type: "queue-operation"` messages whose content matches `<task-notification>` to `SubagentNotification`, but extracts only `<status>` and `<summary>`. Claude Code currently emits five distinct task surfaces, each writing a richer XML envelope:

| Source file (Claude Code) | Extra tags emitted today |
| --- | --- |
| `src/tasks/LocalAgentTask/LocalAgentTask.tsx:252` | `<task-id>`, `<tool-use-id>`, `<output-file>`, `<result>`, `<usage>` (`<total_tokens>`, `<tool_uses>`, `<duration_ms>`), `<worktree>` (`<worktreePath>`, `<worktreeBranch>`) |
| `src/tasks/LocalShellTask/LocalShellTask.tsx:160` | `<task-id>`, `<tool-use-id>`, `<output-file>` |
| `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx:172` | `<task-id>`, `<tool-use-id>`, `<task-type>=remote_agent`, `<output-file>` |
| `src/tasks/LocalMainSessionTask.ts:262` | varies (re-uses task-notification mode) |
| Background bash tasks | `<task-id>`, `<output-file>`, plus exit code in summary |

Status values reaching us also widened: in addition to the literal `"completed" | "killed"` the classifier accepts, callers also emit `"failed"` (LocalAgent, LocalShell, RemoteAgent) and `"stopped"` (LocalAgent on cancellation). Today these map to the type-safe `SubagentNotification.status` field but the union literally excludes both labels, so any downstream `event.status === "failed"` branch would be unreachable in TypeScript.

**Source pointers for the fix:**

- `src/lib/tapClassifier.ts:436-447` (regex against snap content)
- `src/types/tapEvents.ts:119-123` (SubagentNotification interface)
- `src/lib/tapSubagentTracker.ts:457-487` (tracker reads `event.summary` / `event.status`)
- `src/lib/__tests__/tapClassifier.test.ts:181-219` (fixtures only cover 2 fields)

This is what this PR lands.

### A2. `<task-type>` distinguishes remote-agent vs in-process tasks

**Status:** P2 (related to A1; included opportunistically with A1).

`RemoteAgentTask` writes `<task-type>remote_agent</task-type>` so the receiver can tell when a notification refers to a Sourcegraph-style cloud session vs. a local background agent. Today Code Tabs collapses both into the same subagent card. Once captured, the inspector could render a "remote" badge.

### A3. Hook event payloads for `SubagentStart` / `SubagentStop` / `TeammateIdle`

**Status:** P2 (depends on user having corresponding hook configured).

Claude Code's `executeSubagentStartHooks` (`src/utils/hooks.ts:3932`) and the existing `executeSubagentStopHooks` build a `hookInput` object with `hook_event_name: "SubagentStart"` (resp. `SubagentStop`, `TeammateIdle`, `Stop`, `StopFailure`, `WorktreeCreate`, `WorktreeRemove`, `PermissionRequest`, `PermissionDenied`, `UserPromptSubmit`, `SessionStart`, `Setup`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`). Each is passed to `jsonStringify(hookInput)` (`src/utils/slowOperations.ts:170` — a direct `JSON.stringify` wrapper) before being piped into the user's hook command on stdin. Because our `INSTALL_TAPS` wraps `JSON.stringify` globally, every one of these payloads is observable on the wire — but only when a user actually has hooks configured for that event.

`tapClassifier.classifyStringify` (`src/lib/tapClassifier.ts:846-899`) already handles a subset: `SessionEnd`, `Stop`, `StopFailure`, `PreCompact`, `PostCompact`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `FileChanged`, `TaskCreated`, `TaskCompleted`, `Elicitation`, `ElicitationResult` (mapped to `Elicitation`), `Notification`, `SubagentStop`, `Setup`, and `PostToolUseFailure`. Missing:

- `PreToolUse` — emits `tool_name`, `tool_input` shape, `permission_mode`.
- `PostToolUse` — emits `tool_name`, `tool_input`, `tool_response`, `agent_id` when sub-agent triggered.
- `UserPromptSubmit` — emits `prompt`.
- `SessionStart` — `source` (startup|resume|clear|compact), `agent_type`, `model`.
- `SubagentStart` — `agent_id`, `agent_type`. (Subagent end is already mapped.)
- `PermissionRequest` / `PermissionDenied` — `tool_name`, `tool_input`.
- `TeammateIdle` — `teammate_name`, `team_name`. The "teammate" terminology is new for the swarm/in-process-team feature.
- `WorktreeCreate` — `name`.
- `WorktreeRemove` — `worktree_path`.

Each is one new branch in `classifyStringify`. Cost is mechanical; benefit is contingent on a user wiring up hooks, which is non-trivial. **Defer to a follow-up** until we see real demand in a debug capture.

### A4. `subagent_terminal` — user-facing in-process teammates

**Status:** Not a wire signal.

The user said "you can now enter subagent terminals from within the terminal, even though it's annoying." Tracing the Claude Code source: this refers to the **swarm / teammate** feature (`src/utils/swarm/`, `src/tools/TeamCreateTool/`, `src/tasks/InProcessTeammateTask/`). The terminal a user "enters" is either:

- A tmux pane managed by `TmuxBackend` (`src/utils/swarm/backends/TmuxBackend.ts`) when the leader is in tmux.
- An in-process teammate's foregrounded transcript (`BackgroundTasksDialog.tsx:414` — the `f` key foregrounds a running `in_process_teammate`).

There is **no separate process or PTY** spawned for the teammate's terminal — it shares the leader's PTY. The signals that distinguish teammate activity from leader activity are:

1. The `TaskStarted` / `TaskCompleted` hook payloads, which carry `teammate_name` / `team_name` (currently captured but the teammate fields are discarded — see A3).
2. `task-notification` XML, which carries the agent's task id (A1).
3. SDK-only `task_started` / `task_progress` / `task_notification` system messages from `src/utils/sdkEventQueue.ts`. These only flow in non-interactive mode (`getIsNonInteractiveSession()` guard at `src/utils/sdkEventQueue.ts:80`), so the TUI Code Tabs runs against will never emit them. **Not actionable.**

### A5. Codex Collab agent telemetry (already captured)

`CodexSubagentSpawned` / `CodexSubagentStatus` cover all five Collab pairs: `CollabAgentSpawnBegin/End`, `CollabAgentInteractionBegin/End`, `CollabWaitingBegin/End`, `CollabCloseBegin/End`, `CollabResumeBegin/End` (per `[CX-04]`). No gap.

---

## Part B — General stream/event signals (Claude Code)

### B1. `system.subtype === "turn_duration"` carries budget fields we drop

**Status:** P2.

`createTurnDurationMessage` (`src/utils/messages.ts:4428`) emits `budgetTokens`, `budgetLimit`, `budgetNudges` alongside `durationMs` / `messageCount`. We classify the event (`tapClassifier.ts:800`) and surface only `durationMs` + `messageCount`. Budget data is what powers Claude's own "X tokens · usage · Y nudges" status line — useful for our token-pressure UI.

Fix: add three optional numeric fields to `TurnDuration` and pluck them in `classifyStringify`.

### B2. `system.subtype === "away_summary"`

**Status:** P3 (only fires after sleep mode).

`createAwaySummaryMessage` (`src/utils/messages.ts:4447`) emits a one-line digest when Claude resumes after a sleep. We don't catch it. Niche; defer.

### B3. SDK `task_progress` / `task_started` / `task_notification` / `session_state_changed` / `post_turn_summary` / `tool_progress` / `hook_started` / `hook_progress` / `hook_response` / `compact_boundary`

**Status:** Not actionable in TUI.

All of these flow through `enqueueSdkEvent` (`src/utils/sdkEventQueue.ts:77`), which short-circuits `if (!getIsNonInteractiveSession())`. The TUI mode our user runs never queues these. Mentioned here only so a future audit doesn't go searching for them again.

### B4. `progress` messages with `data.type === "hook_progress"` — fully captured today

`HookProgress` is wired through `tapClassifier.ts:404-413`. Adequate.

### B5. ApiTelemetry — uncovered fields

**Status:** P3.

`src/utils/messages.ts` `createAssistantAPITurnMessage` and friends emit `costUSD`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `uncachedInputTokens`, `durationMs`, `ttftMs`, `queryChainId`, `queryDepth`, `querySource`, `stopReason` — all captured. The CLI also emits `serverToolUses` (count of server-side tool invocations) and `cacheCreationInputTokens` separately from `cachedInputTokens`. Not captured. Niche.

### B6. `system.subtype === "api_retry"` is a non-TUI mirror of our existing `ApiRetry`

The `rh` telemetry path that produces our `ApiRetry` is the interactive path. The `api_retry` SDK message (`src/QueryEngine.ts:946`) is only yielded in headless mode. Existing coverage adequate.

### B7. `sub-agent` reasoning summaries on the `recent_action` field

**Status:** Not actionable.

`SDKPostTurnSummaryMessageSchema` (`coreSchemas.ts:1544`) carries `recent_action`, `needs_action`, and `status_category` (one of `blocked|waiting|completed|review_ready|failed`). Excellent data — but SDK-only.

---

## Part C — Codex rollout signals

The Codex protocol (`codex-rs/protocol/src/protocol.rs:1273` — `pub enum EventMsg`) has grown substantially since the last audit. Our `codex_rollout.rs` maps a subset directly; the catch-all `_` branch logs the rest as `codex.event_msg` debug entries.

### C1. Already mapped

`task_started`, `task_complete`, `turn_aborted`, `token_count`, `exec_command_end`, `function_call` → `codex-tool-call-start` + `codex-tool-input`, `function_call_output`, `custom_tool_call`/`_output`, `message`, `compacted`, `session_meta`, `session_configured`, `turn_context`, `mcp_tool_call_begin`, `mcp_tool_call_end`, all five `collab_*_end` events.

### C2. Useful but unmapped EventMsg variants

| Variant | Why it might matter |
| --- | --- |
| `exec_command_begin` | We currently only show the tool-call once the command completes; emitting on begin would let us show an "exec in progress" indicator with the same fidelity as Claude. |
| `exec_command_output_delta` | Streaming stdout for in-progress execs. Today the inspector waits for `exec_command_end` to see anything; deltas would enable a live tail. |
| `terminal_interaction` | New event for interactive `stdin` → `stdout` round-trips inside a running command. No coverage. |
| `patch_apply_begin` / `_updated` / `_end` | `apply_patch` lifecycle — we get the `function_call_output` but nothing about which hunks landed vs. were rejected. |
| `turn_diff` | A full diff for the current Codex turn. Aligns with our `FileHistorySnapshot` event from Claude — a "files changed this turn" signal. |
| `plan_update` / `plan_delta` | Codex's "thinking plan" lifecycle. We don't surface plan content at all today. |
| `stream_error` | Stream disconnect/retry; mirrors Claude's `ApiRetry`. |
| `web_search_begin` / `_end`, `image_generation_begin` / `_end` | Tool-call-like events for two built-in tools we currently bucket as "unknown tool". |
| `model_reroute`, `model_verification`, `context_compacted`, `thread_rolled_back`, `thread_goal_updated`, `deprecation_notice`, `guardian_warning`, `guardian_assessment`, `agent_reasoning_section_break` | Per-turn lifecycle context; mostly useful for the model/context viewer. |
| `hook_started` / `hook_completed` | Codex now supports hooks (`HookEventName` enum at `protocol.rs:1464` — PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SessionStart, UserPromptSubmit, Stop). When a hook runs in Codex, these fire with a full `HookRunSummary` (`id`, `event_name`, `handler_type`, `execution_mode`, `scope`, `source_path`, `display_order`, `status`, `entries`, etc.). Direct counterpart to Claude's `HookProgress`. |

All of these would land in `emit_event_msg` (`src-tauri/src/observability/codex_rollout.rs:1265`). Pure additions to the existing match.

### C3. Workflow signals

The user mentioned subagents specifically; for Codex the equivalent surface is **Collab agents** (already covered, A5) and **the Workflow scaffolding inside `LocalWorkflowTask`**. Workflow progress events flow through `SdkWorkflowProgress[]` deltas on `task_progress` (non-interactive only, B3) — not actionable for our TUI consumer.

---

## Part D — Terminal output / discovery gaps

`npm run discover:audit -- --format pretty` (binary at `src-tauri/target/debug/discover_audit`) currently reports:

```
Commands: 5 missing, 83 extra (informational)
  MISSING /cost
  MISSING /pr-comments
  MISSING /release-notes
  MISSING /stats
  MISSING /vim

Settings: 0 missing, 775 extra (informational)

Env vars: 1 missing, 577 extra (informational)
  MISSING CLAUDE_CODE_TEAM_NAME
```

### D1. Five commands documented but not discovered

**Status:** P2.

- `/cost` and `/vim` exist in Claude Code source (`src/commands/cost/index.ts`, `src/commands/vim/index.ts`). Both have `type: 'local'` but `/cost` declares `isHidden` as a getter, not a literal — the regex check at `src-tauri/src/discovery/claude.rs:603` only rejects `isHidden:!0`. The minified output for `/cost` likely emits a getter form (`get isHidden(){return …}`) that doesn't match either branch, but something else is also pruning these from the scanner output.
- `/release-notes` is explicitly filtered at `src-tauri/src/discovery/claude.rs:665` (`&& cmd != "/release-notes"`). This is a documented filter — keep or revisit, but the audit fixture should be updated to reflect intent.
- `/pr-comments` is registered as a plugin command (`pluginName: 'pr-comments'`, `pluginCommand: 'pr-comments'`). The scanner has a marker for `pluginCommand:"…"` (line 583) but the name regex `BUILTIN_NAME_RE = r#"name:"([\w][\w-]*)""#` would still need to find a `name:"pr-comments"` literal nearby.
- `/stats` declares `type: 'local-jsx'` so it should hit the marker `type:"local-jsx"`. Probably the same minifier issue.

**Recommendation:** open a focused investigation issue. Out of scope for this PR.

### D2. `CLAUDE_CODE_TEAM_NAME` env var

**Status:** P3.

Not in our discovered set. New env var introduced with the teammate feature. One-line fix: add it to the env-var scanner's allowlist or follow the regex through to the source.

### D3. Settings — 0 missing

Discovery is fully caught up against docs as cached. No action.

---

## Recommendations summary

| Priority | Item | Where it lands |
| --- | --- | --- |
| **P1 (this PR)** | Expand `SubagentNotification` to carry `taskId`, `toolUseId`, `outputFile`, `taskType`, `result`, `usageTokens`/`usageToolUses`/`usageDurationMs`, `worktreePath`/`worktreeBranch`; widen `status` union to include `failed` and `stopped`. | `src/types/tapEvents.ts`, `src/lib/tapClassifier.ts`, `src/lib/tapSubagentTracker.ts` (surface `outputFile`/`result` on subagent cards), test fixtures in `src/lib/__tests__/tapClassifier.test.ts`. |
| P2 | Add `budgetTokens`, `budgetLimit`, `budgetNudges` to `TurnDuration`. | `src/types/tapEvents.ts:347`, `src/lib/tapClassifier.ts:800`. |
| P2 | Add hook payload branches for `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SubagentStart`, `PermissionRequest`, `PermissionDenied`, `TeammateIdle`, `WorktreeCreate`, `WorktreeRemove`. | `src/lib/tapClassifier.ts:849`. |
| P2 | Map Codex `exec_command_begin`, `exec_command_output_delta`, `patch_apply_*`, `turn_diff`, `plan_update`, `stream_error`, `web_search_*`, `image_generation_*`, `hook_started`/`hook_completed`. | `src-tauri/src/observability/codex_rollout.rs:1265-1704`. |
| P2 | Investigate why `/cost`, `/vim`, `/stats`, `/pr-comments` are not picked up by the builtin command regex (likely minifier emitting getter or different quote style). | `src-tauri/src/discovery/claude.rs:505`. |
| P3 | Add `CLAUDE_CODE_TEAM_NAME` to env-var discovery. | `src-tauri/src/discovery/mod.rs`. |
| P3 | Add `system.subtype === "away_summary"` tap event. | `src/lib/tapClassifier.ts`. |
| P3 | Add `serverToolUses` + `cacheCreationInputTokens` to `ApiTelemetry`. | `src/types/tapEvents.ts`, `src/lib/tapClassifier.ts`. |

---

## What this PR ships

Only **P1 (A1+A2)**: a richer `SubagentNotification` shape and a wider status union, plus tests for each new tag. Everything else is deferred — see the recommendations table.
