# Tap Migration Plans

Agent prompts for migrating from polling/terminal-parsing to tap-driven event architecture. Each plan is self-contained. Reference the tap log at `C:\Users\jorda\AppData\Local\claude-tabs\taps\de09698e-c158-45dc-b9e4-7e85785e0223.jsonl` and conversation at `C:\Users\jorda\AppData\Local\claude-tabs\taps\convo.txt` for real examples. Also reference `DOCS/TAP-SIGNALS.md` for the full signal catalogue.

---

## Plan 1: Event-Driven Agent State Machine

**What exists:** `useInspectorState.ts` polls `POLL_STATE` every 250ms via WebSocket `Runtime.evaluate`. State is derived from an event buffer in the hooked process. The 250ms polling creates race conditions — the terminal buffer fallback at lines 151-165 exists specifically because polling misses events, causing stuck "thinking" states. The inspector hook in `inspectorHooks.ts` (lines 40-170) maintains its own state machine (`'i'`/`'t'`/`'u'`/`'s'` codes) that the poll reads.

**What taps provide:** `cat=parse` gives the SSE stream directly — `message_start`, `content_block_start` (type=thinking/text/tool_use), `message_delta` (stop_reason=end_turn|tool_use), `message_stop`. These are push events with zero ambiguity.

**The change:** Process tap entries in `useTapRecorder.ts` (or a new `useTapState.ts` hook) to derive session state as events arrive, rather than polling a separate state buffer. The tap buffer is already polled at 500ms but could be reduced, or the state derivation could live alongside the existing poll.

**State mapping from tap parse events:**

| Tap Event | State |
|-----------|-------|
| `message_start` | `responding` |
| `content_block_start` type=`thinking` | `thinking` |
| `content_block_start` type=`text` | `responding` |
| `content_block_start` type=`tool_use` | `toolUse` (+ set currentToolName from `name` field) |
| `message_delta` stop=`end_turn` | `idle` |
| `message_delta` stop=`tool_use` | `toolUse` (executing, next turn coming) |

Plus from `cat=stringify`:
| Tap Event | State |
|-----------|-------|
| snap contains `"notification_type":"permission_prompt"` or `setMode` + `acceptEdits` | `waitingPermission` |
| snap contains `type:"user"` + `display` field | `responding` (user just submitted, API call imminent) |

**Kill the terminal buffer fallback** (lines 151-165 in useInspectorState.ts) — the prompt marker detection (`">\u00A0"`, `"\u276F"`) that forces idle when events are missed. Tap events don't miss.

**Files to examine:** `src/hooks/useInspectorState.ts`, `src/lib/inspectorHooks.ts` (INSTALL_HOOK + POLL_STATE), `src/hooks/useTapRecorder.ts`, `src/store/sessions.ts` (updateState, updateMetadata), `src/components/Terminal/TerminalPanel.tsx` (where hooks are instantiated).

**Data to collect before starting:** Run a session with all taps enabled. Perform: idle, type a message, get a text response, trigger thinking, trigger tool_use (Bash), trigger subagent (Agent), trigger permission prompt, trigger AskUserQuestion prompt, interrupt a tool. Collect the JSONL. This covers all state transitions.

---

## Plan 2: Replace Input Accumulator with Tap Events

**What exists:** `inputAccumulator.ts` is a 124-line `LineAccumulator` class that reconstructs user-submitted lines from raw PTY byte streams. It handles escape sequences (CSI, SS3, bracketed paste), backspace, Ctrl+C/U, and accumulates printable chars with a 500-char safety cap. `ptyRegistry.ts` routes all PTY writes through it, detects slash commands (`line.charAt(0) === "/"`), and calls `addCommandHistory()`.

**What taps provide:** `cat=stringify` fires a `display` event the instant the user presses Enter:
```json
{"display":"spawn a subagent to write a 500 word horse limerick","pastedContents":{},"timestamp":1774524049171,"project":"C:\\Users\\jorda\\PycharmProjects\\claude_tabs","sessionId":"de09698e-..."}
```

Clean text, no ANSI parsing, no escape sequence handling, paste detection built in.

**The change:** Watch for stringify entries with `display` + `sessionId` + `timestamp` fields. Extract the `display` value as the user's input. Detect slash commands with `display.startsWith("/")`. This replaces the entire LineAccumulator and the slash-command detection in ptyRegistry.

**What to keep:** `ptyRegistry.ts` still manages PTY writers and kill registry — only the LineAccumulator and command detection parts are replaced.

**Edge cases to verify:** Does the `display` event fire for empty submissions? For paste-only input? For multiline input? For `/help` (which is handled client-side by Claude Code)? Check the tap log for the `/help` command at ~251s. Also verify the `pastedContents` field structure when paste is involved.

**Files to examine:** `src/lib/inputAccumulator.ts`, `src/lib/ptyRegistry.ts`, `src/store/sessions.ts` (addCommandHistory, commandHistory), `src/hooks/useTapRecorder.ts`.

**Data to collect before starting:** Run a session with stringify taps on. Type normal text, paste text, use slash commands (/help, /compact, a custom one), type and backspace, Ctrl+C a prompt, submit empty. Collect the JSONL and note which `display` events fire for each.

---

## Plan 3: Tap-Driven Cost, Token, and Telemetry Display

**What exists:** Cost/token tracking comes from the inspector POLL_STATE polling. `inspectorHooks.ts` lines 70-72 accumulate `inTok`/`outTok`/`cost` from `result` events in the hooked process. StatusBar reads `session.metadata.costUsd`, `inputTokens`, `outputTokens`. The `contextPercent` field exists but is **always 0** — never populated. `assistantMessageCount` is also **always 0**.

**What taps provide:** `cat=stringify` contains per-turn API completion telemetry:
```json
{"model":"claude-opus-4-6","inputTokens":3,"outputTokens":180,"cachedInputTokens":20194,"uncachedInputTokens":32,"durationMs":4232,"costUSD":0.0145,"stop_reason":"tool_use","ttftMs":1907,"queryChainId":"2738b6d4-...","queryDepth":0}
```

And `cat=parse` `message_delta` contains:
```json
{"usage":{"input_tokens":3,"cache_creation_input_tokens":8766,"cache_read_input_tokens":11428,"output_tokens":180},"context_management":{"applied_edits":[]}}
```

And `cat=stringify` process memory telemetry (~1/sec):
```json
{"uptime":42.5,"rss":562814976,"heapTotal":31844352,"heapUsed":39393222,"cpuPercent":0}
```

And `cat=stringify` rate limit status:
```json
{"status":"allowed_warning","hoursTillReset":16}
```

**The change — new data to display:**
1. **Fill `contextPercent`**: Use `cache_read_input_tokens` from `message_delta` usage. Context grows as this number rises. Calculate percentage against known model context window (200K for opus, etc.). Also watch `context_management.applied_edits` — when non-empty, context compression happened.
2. **Fill `assistantMessageCount`**: Count `message_stop` events from parse.
3. **Add TTFT to StatusBar**: `ttftMs` from stringify telemetry. Show time-to-first-token per turn.
4. **Add per-turn cost**: `costUSD` from stringify telemetry. Show running total AND last-turn cost.
5. **Add cache hit ratio**: `cachedInputTokens` / (`cachedInputTokens` + `uncachedInputTokens`) shows cache efficiency.
6. **Add RSS/heap memory**: From process memory telemetry. Show in StatusBar or DebugPanel.
7. **Add rate limit warning**: From stringify `status:"allowed_warning"` events.
8. **Add request body size trend**: `bodyLen` from `cat=fetch` tracks conversation context growth per API call.

**Files to examine:** `src/components/StatusBar/StatusBar.tsx`, `src/types/session.ts` (SessionMetadata), `src/store/sessions.ts` (updateMetadata), `src/hooks/useInspectorState.ts` (where metadata is currently set), `src/hooks/useTapRecorder.ts`.

**Data to collect before starting:** The existing tap log covers this well. Focus on the stringify entries with `costUSD`, `ttftMs`, `durationMs` fields, and parse entries with `message_delta` usage. Note the cache_read growth pattern: 0 -> 11428 -> 20194 -> ... -> 28274.

---

## Plan 4: Tap-Driven Subagent Tracking

**What exists:** Subagent detection in `inspectorHooks.ts` (lines 90-162) routes events by `agentId`. State machine tracks `'s'`/`'t'`/`'u'`/`'i'` per subagent. `useInspectorState.ts` (lines 218-248) processes polled subagent data, deduplicates, and calls `addSubagent()`/`updateSubagent()`. Messages capped at 200 per subagent. The SubagentInspector component renders state, tokens, messages.

**What taps provide:**
1. **Spawn:** `cat=parse` `content_block_start` type=`tool_use` name=`Agent` — exact spawn moment
2. **Task description:** `cat=stringify` with `description` + `prompt` fields — what the subagent is doing
3. **Subagent turns:** `cat=stringify` conversation messages with `isSidechain:true` + `agentId` — identifies which messages belong to subagents
4. **Subagent completion:** `cat=stringify` telemetry with `toolName:"Agent"`, `durationMs:24224`, `toolResultSizeBytes:3151`
5. **Subagent's own API calls:** `cat=fetch` with smaller `bodyLen` (drops from ~80K to ~42K at subagent boundary)
6. **Subagent state per turn:** `cat=parse` `message_delta` with `stop_reason` within the subagent's turns

**The change:** Build subagent lifecycle from tap events instead of (or alongside) the inspector state machine. This gives richer data: the full subagent prompt, task description, completion duration, result size. Currently the SubagentInspector shows state + tokens + messages — taps add description, prompt, duration, result size.

**New capability:** The `queryChainId` and `queryDepth` fields in the stringify telemetry can link parent and subagent API calls. `queryDepth=0` is the parent, `queryDepth=1` would be the subagent.

**Files to examine:** `src/lib/inspectorHooks.ts` (INSTALL_HOOK subagent routing lines 90-162), `src/hooks/useInspectorState.ts` (subagent processing lines 218-248), `src/store/sessions.ts` (addSubagent, updateSubagent, clearIdleSubagents, Subagent type), `src/components/SubagentInspector/SubagentInspector.tsx`, `src/types/session.ts` (Subagent interface).

**Data to collect before starting:** Run a session that spawns 2-3 subagents with different tasks. Enable all taps. Look for `isSidechain:true` messages and `queryDepth` in telemetry.

---

## Plan 5: Tap-Driven Permission and Plan Mode

**What exists:** Permission detection in `inspectorHooks.ts` line 77: `notification_type === 'permission_prompt'` sets `permPending = true`. Plan mode not explicitly tracked — relies on the `permissionMode` field in inspector data. `useInspectorState.ts` line 86: `if (data.permPending) state = "waitingPermission"`. Terminal prompt detection at lines 151-165 used as fallback when permission state is lost.

**What taps provide:**
1. **Permission prompt shown:** `cat=stringify` with `[{"type":"setMode","mode":"acceptEdits","destination":"session"}]`
2. **Permission granted:** tool result proceeds normally (no rejection text)
3. **Permission rejected:** `cat=stringify` tool result containing `"The user doesn't want to proceed with this tool use. The tool use was rejected"`
4. **User interruption:** Two sequential messages: tool result with rejection + user message `"[Request interrupted by user for tool use]"`
5. **Permission mode changes:** `permissionMode` field on every stringify conversation message — values: `bypassPermissions`, `default`, `plan`
6. **Plan mode enter/exit:** `EnterPlanMode`/`ExitPlanMode` tool_use events in parse
7. **Plan content:** Write tool input with plan file path + content in stringify
8. **Plan approval timing:** `waiting_for_user_permission_ms` in stringify telemetry
9. **AskUserQuestion prompts:** Full question schema with options in stringify, answer in tool result

**The change:** Drive permission/plan state from tap events. The `setMode` event fires the instant the permission dialog appears — no polling lag. The `permissionMode` field on conversation messages gives authoritative mode state. Plan creation/approval is a distinct event chain that could trigger UI state (show plan preview panel, highlight tab).

**New capability — choice/selector detection:** Currently `useInspectorState.ts` lines 151-157 scan the terminal buffer for `"> 1."` patterns to detect Ink selectors. The AskUserQuestion tap event contains the full schema with options, question text, and headers — much richer than terminal scraping.

**Files to examine:** `src/hooks/useInspectorState.ts` (permission detection, selector detection), `src/lib/inspectorHooks.ts` (permission_prompt notification), `src/store/sessions.ts` (session state), `src/components/Terminal/TerminalPanel.tsx`.

**Data to collect before starting:** The existing log has all of these. See timestamps 258-267s (AskUserQuestion flow), 277-306s (plan flow), 313-360s (permission flow with rejection). Collect a session where you approve a permission too (not just reject).

---

## Plan 6: Conversation Tree and Session Identity from Taps

**What exists:** Session metadata (name, title, working dir) comes from the session config at spawn time. Tab titles use `session.name || dirToTabName(workingDir)`. The conversation itself is only accessible via JSONL files on disk (read by Rust backend). No live conversation tree in the frontend.

**What taps provide:**
1. **Session registration:** `cat=stringify` with `pid`, `sessionId`, `cwd`, `startedAt`, `kind`, `entrypoint`, `name`
2. **Custom title:** `cat=stringify` with `type:"custom-title"` + `customTitle` + `sessionId` — fires when Claude names the session
3. **Agent name:** `cat=stringify` with `type:"agent-name"` + `agentName` — fires for worktree names
4. **Full conversation tree:** Every user and assistant message via stringify, with `uuid`, `parentUuid`, `isSidechain`, `agentId`, `promptId` for full threading
5. **Startup config:** `cat=stringify` with `entrypoint`, `permissionMode`, `numAllowedTools`, `worktree:true`
6. **Account info:** `cat=stringify` with `subscriptionType`, `billingType`, `rateLimitTier`, `displayName`
7. **Turn duration:** `cat=stringify` with `type:"system"`, `subtype:"turn_duration"`, `durationMs`, `messageCount`
8. **File history:** `cat=stringify` with `type:"file-history-snapshot"` tracking which files each turn modified

**The change:**
1. **Live tab title update:** Watch for `custom-title` and `agent-name` stringify events. Update `session.name` immediately instead of waiting for the user to see it in terminal output.
2. **Session metadata enrichment:** On `session registration` event, populate PID, entrypoint, start time. On account info, show subscription tier.
3. **File change tracking from taps:** The `file-history-snapshot` events tell us which files were modified per turn, supplementing (or replacing) the 2s git status polling for "what did Claude just change?" detection.
4. **Turn duration display:** `turn_duration` events give exact per-turn timing from Claude Code itself.

**Files to examine:** `src/store/sessions.ts` (session name, metadata updates), `src/components/StatusBar/StatusBar.tsx`, `src/App.tsx` (tab bar title rendering), `src/hooks/useGitStatus.ts` (polling that could be supplemented).

**Data to collect before starting:** The existing log has session registration at 0.6s, custom-title at ~3.6s, and file-history-snapshot events. Run another session that creates/modifies files to see richer file-history data.

---

## Plan 7: Hook Execution Visibility

**What exists:** The StatusBar shows a hook count badge. No visibility into which hooks are running, their progress, or timing.

**What taps provide:**
1. **Hook progress:** `cat=stringify` with `type:"progress"`, `data.type:"hook_progress"`, `hookEvent`, `hookName`, `command`, `statusMessage`
   ```json
   {"type":"progress","data":{"type":"hook_progress","hookEvent":"PostToolUse","hookName":"PostToolUse:Write","command":"Type-checking...","statusMessage":"Type-checking..."}}
   ```
2. **Hook environment:** `cat=stringify` with `hook_event_name`, `tool_name`, `tool_input`, `tool_response`, `permission_mode`
3. **Hook subprocess:** `cat=bun.spawn` entries correlated by timestamp with hook_progress events

**The change:** Show active hook execution in the StatusBar or a dedicated hook status area. When a PostToolUse hook fires (e.g., type-checking after Write), show it as a transient status: "Hook: Type-checking..." with a spinner. This explains pauses between tool execution and next response.

**Files to examine:** `src/components/StatusBar/StatusBar.tsx`, `src/hooks/useTapRecorder.ts`.

**Data to collect before starting:** The existing log shows PostToolUse:Write hook at 32.1s. Run a session that triggers multiple hooks (pre/post tool use, user prompt submit) and collect the tap data.

---

## Data Collection Checklist

Before passing plans to agents, collect one comprehensive tap log with all categories enabled. The session should cover:

- [ ] Simple text exchange (type "test", get response)
- [ ] Slash command (e.g., /compact, /help, a custom command)
- [ ] Subagent spawn (ask for an agent to do something)
- [ ] Multiple subagents (ask for parallel agents)
- [ ] AskUserQuestion prompt (trigger a numbered selector, answer it)
- [ ] Plan mode (request /plan, approve it)
- [ ] Permission prompt — both approve and reject
- [ ] User interruption (Ctrl+C or Escape during tool execution)
- [ ] Thinking mode (ask something that requires reasoning)
- [ ] File modification (Edit/Write tools)
- [ ] Bash command execution
- [ ] Long idle period between prompts
- [ ] Context window growth (many turns to see cache_read grow)

The existing `de09698e` log covers most of these except: multiple subagents, slash commands (other than /help which is client-side), permission approval, and Ctrl+C interruption.
