# Tap Signal Reference

Catalogue of state signals obtainable from Claude Code's runtime via the BUN_INSPECT tap system. Each signal includes what it replaces, the detection pattern, and real examples from a test session.

**Session:** `de09698e`, 6,774 JSONL entries, 381 seconds, 21 API turns.

---

## 1. Agent State Machine

**Replaces:** Terminal output parsing + polling for thinking/idle/responding/tool-use detection.

The API SSE events in `cat=parse` give an unambiguous state machine with zero polling:

| SSE Event | State Transition | Fields |
|-----------|-----------------|--------|
| `message_start` | -> RESPONDING | `message.model`, `message.usage` |
| `content_block_start` type=`thinking` | -> THINKING | `index` (always 0) |
| `content_block_start` type=`text` | -> STREAMING TEXT | `index` |
| `content_block_start` type=`tool_use` | -> TOOL: {name} | `content_block.name`, `content_block.id` |
| `content_block_stop` | block finished | `index` |
| `message_delta` | -> TURN COMPLETE | `delta.stop_reason`, `usage` (final) |
| `message_stop` | -> IDLE or PROCESSING | (none) |

**State transitions from `message_delta.stop_reason`:**
- `end_turn` -> **IDLE** (waiting for user input)
- `tool_use` -> **PROCESSING** (executing tool, next API call coming)

### Examples

Thinking then tool use (subagent spawn):
```
[10.4s] parse: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}
[11.2s] parse: {"type":"content_block_stop","index":0}
[11.2s] parse: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01Fba...","name":"Agent","input":{}}}
[12.5s] parse: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":180}}
```

Simple text response (idle after):
```
[38.1s] parse: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
[42.2s] parse: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":211}}
[42.2s] parse: {"type":"message_stop"}
```

---

## 2. User Input Detection

**Replaces:** `inputAccumulator.ts` / `LineAccumulator` parsing raw PTY bytes to detect what the user typed.

Two complementary stringify events fire when the user presses Enter:

### 2a. Display Event (clean prompt text)

**Pattern:** `cat=stringify`, snap contains `display` + `sessionId` + `timestamp` + `project`.

```json
{"display":"spawn a subagent to write a 500 word horse limerick","pastedContents":{},"timestamp":1774524049171,"project":"C:\\Users\\jorda\\PycharmProjects\\claude_tabs","sessionId":"de09698e-..."}
```

One per user turn. The `display` field is exactly what the user typed — no ANSI, no system wrappers. `pastedContents` detects paste events. Slash command detection: `display.startsWith("/")`.

### 2b. Conversation Message (full structured)

**Pattern:** `cat=stringify`, snap contains `type:"user"` + `message.role:"user"` + `uuid` + `promptId`.

```json
{"parentUuid":null,"isSidechain":false,"promptId":"24e65479-...","type":"user","message":{"role":"user","content":"spawn a subagent to write a 500 word horse limerick"},"uuid":"8435de4c-...","timestamp":"2026-03-26T11:20:49.282Z","permissionMode":"bypassPermissions","cwd":"C:\\Users\\jorda\\PycharmProjects\\claude_tabs","sessionId":"de09698e-...","version":"2.1.84"}
```

This is the full conversation node with `parentUuid` (for threading), `promptId` (groups a user turn + all API exchanges), `permissionMode`, `cwd`, and `version`. Subagent messages have `isSidechain:true` and `agentId`.

### All 7 user inputs detected in the test session:

| Time | Display |
|------|---------|
| 1.3s | `"test"` |
| 8.3s | `"spawn a subagent to write a 500 word horse limerick"` |
| 258.3s | `"Can you ask me a question with a 1/2/3/4 input?"` |
| 277.4s | `"Can you come up with a quick /plan so I can approve it? Testing a Claude Code app."` |
| 313.3s | `"OK, good. Finally, do something that would require permissions"` |
| 328.2s | `"Nope - didn't trigger."` |
| 345.6s | `"This didn't work - I think there are specific kinds of actions..."` |

---

## 3. Tool Use Tracking

**Replaces:** Terminal output scraping for tool names and results.

### 3a. Tool Call Start

**Pattern:** `cat=parse`, `type:"content_block_start"`, `content_block.type:"tool_use"`.

```json
{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01Fba...","name":"Agent","input":{},"caller":{"type":"direct"}}}
```

Fields: `name` (tool being called), `id` (correlates to result), `caller.type`.

### 3b. Tool Input (streaming)

**Pattern:** `cat=parse`, `type:"content_block_delta"`, `delta.type:"input_json_delta"`.

323 entries in the session. Fragments concatenate to form the full tool input JSON. For the Agent call:
```
{"partial_json":""}
{"partial_json":"{\""}
{"partial_json":"description"}
{"partial_json":"\":\"Write 500-word horse limerick\""}
...
```

### 3c. Tool Input (complete, from stringify)

**Pattern:** `cat=stringify`, snap is the complete tool input object. Appears after the streaming completes.

```json
{"description":"Write 500-word horse limerick","prompt":"Write a limerick (or series of limericks) about horses that totals approximately 500 words..."}
```

Also captured for all other tools:
- **Bash:** `{"command":"git status --short","description":"Show working tree status"}`
- **Edit:** `{"file_path":"...App.tsx","old_string":"import { useEffect...","new_string":"// test comment\nimport { useEffect..."}`
- **Read:** `{"file_path":"...App.tsx","limit":3}`
- **ToolSearch:** `{"query":"select:AskUserQuestion","max_results":1}`
- **AskUserQuestion:** `{"questions":[{"question":"What's your favorite season?","header":"Season","options":[{"label":"Spring"},{"label":"Summer"},{"label":"Autumn"},{"label":"Winter"}]}]}`

### 3d. Tool Results (from stringify)

**Pattern:** `cat=stringify`, snap contains `type:"tool_result"` + `tool_use_id`.

Embedded in user conversation messages. Example (AskUserQuestion answer):
```
content: "User has answered your questions: \"What's your favorite season of the year?\"=\"Spring\". You can now continue with the user's answers in mind."
```

Error example (Edit without reading first):
```
content: "File has not been read yet. Read it first before writing to it."
is_error: true
```

### All 13 tool calls detected in the test session:

| Time | Tool | Context |
|------|------|---------|
| 11.2s | Agent | Subagent for horse limericks |
| 259.9s | ToolSearch | Resolving AskUserQuestion |
| 261.9s | AskUserQuestion | Season preference (user chose Spring) |
| 280.7s | ToolSearch | Resolving EnterPlanMode |
| 282.7s | EnterPlanMode | User requested a plan |
| 286.8s | Write | Plan file created |
| 298.2s | ToolSearch | Resolving ExitPlanMode |
| 300.8s | ExitPlanMode | Plan presented for approval |
| 315.0s | Bash | `git status --short` |
| 332.3s | Bash | `npm run build:debug` (interrupted) |
| 351.2s | Edit | App.tsx (failed: not read) |
| 354.6s | Read | App.tsx (limit=3) |
| 357.0s | Edit | App.tsx (permission triggered, rejected) |

---

## 4. Token / Cost Tracking

**Replaces:** JSONL conversation file processing for cost estimation.

### 4a. Per-Turn Token Usage (from parse)

`message_start` gives initial counts, `message_delta` gives **final authoritative counts**:

```json
{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":3,"cache_creation_input_tokens":8766,"cache_read_input_tokens":11428,"output_tokens":180}}
```

### 4b. Per-Turn Cost (from stringify telemetry)

**Pattern:** `cat=stringify`, snap contains `costUSD` + `model` + `durationMs` + `ttftMs`.

```json
{"model":"claude-opus-4-6","messageCount":3,"messageTokens":20210,"inputTokens":3,"outputTokens":180,"cachedInputTokens":20194,"uncachedInputTokens":32,"durationMs":4232,"costUSD":0.0145,"stop_reason":"tool_use","requestId":"req_011CZRbu...","queryChainId":"2738b6d4-...","queryDepth":0,"ttftMs":1907}
```

This is the richest per-turn data source: exact USD cost, time-to-first-token, total duration, cached vs uncached breakdown, and the `queryChainId`/`queryDepth` for tracking multi-turn tool chains.

### 4c. Request Body Size (from fetch)

`bodyLen` on fetch events tracks conversation context growth:

| Turn | bodyLen | Context |
|------|---------|---------|
| 1 | 1,528 | Haiku title generation |
| 2 | 78,286 | First Opus turn |
| 5 | 42,200 | **Subagent** (separate context, small) |
| 6 | 82,657 | Back to parent context |
| 21 | 113,719 | End of session |

Drops in bodyLen flag subagent spawns (new context, small body) vs parent continuation (body resumes growing).

---

## 5. Model Identification

**Replaces:** Terminal regex matching ANSI-styled model names.

`message_start` in parse gives the exact model per turn:

```json
{"type":"message_start","message":{"model":"claude-opus-4-6",...}}
```

Session pattern:
- 2 calls to `claude-haiku-4-5-20251001` (title generation, plan summarization)
- 19 calls to `claude-opus-4-6` (all real work)

The haiku calls are identifiable by their small `bodyLen` (~1,500 bytes) and fast duration (~650-786ms).

---

## 6. Subagent Lifecycle

**Replaces:** Inspector WebSocket monitoring + terminal output parsing for subagent status.

Complete subagent lifecycle from taps:

1. **Spawn:** `content_block_start` type=`tool_use` name=`Agent` (parse)
2. **Task details:** stringify with `description` + `prompt` fields
3. **Subagent turns:** separate `message_start`/`message_delta` pairs (identifiable by lower `cache_read_input_tokens` and different `queryDepth`)
4. **Completion:** stringify telemetry with `toolName:"Agent"`, `durationMs`, `toolResultSizeBytes`

```json
{"toolName":"Agent","durationMs":24224,"toolResultSizeBytes":3151}
```

The subagent's conversation messages have `isSidechain:true` and `agentId` in the stringify conversation nodes.

---

## 7. Permission / Approval Events

**Replaces:** Terminal output parsing for permission prompts and approval state.

### 7a. Permission Mode

Track via `permissionMode` field on conversation messages (stringify):
- `"bypassPermissions"` — all tools auto-approved
- `"default"` — normal permission mode
- `"plan"` — read-only plan mode

### 7b. Permission Prompt Shown

**Pattern:** `cat=stringify`, snap contains `[{"type":"setMode","mode":"acceptEdits","destination":"session"}]`.

This fires the instant the permission dialog appears to the user.

### 7c. User Rejection

**Pattern:** `cat=stringify`, tool_result containing `"The user doesn't want to proceed with this tool use. The tool use was rejected"`.

### 7d. User Interruption

Two messages in sequence sharing the same `promptId`:
1. Tool result with rejection text
2. User message: `"[Request interrupted by user for tool use]"`

### 7e. Approval Timing

Stringify telemetry: `waiting_for_user_permission_ms` measures how long the user took to respond.

```json
{"toolName":"Edit","waiting_for_user_permission_ms":1641}
```

---

## 8. Plan Mode

**Replaces:** Terminal output parsing for plan creation/approval.

Distinctive event chain:

1. `EnterPlanMode` tool_use (parse) -> `permissionMode` changes to `"plan"` (stringify)
2. `Write` tool_use creates plan file at `~/.claude/plans/{name}.md` (stringify)
3. `ExitPlanMode` tool_use with full plan text in input (stringify)
4. User approval: `waiting_for_user_permission_ms` in telemetry (stringify)
5. Haiku summarization call: `message_start` with `model=claude-haiku-4-5-20251001` (parse)
6. `permissionMode` returns to `"default"` (stringify)

Plan file path and content are in the Write tool input:
```json
{"file_path":"C:\\Users\\jorda\\.claude\\plans\\sprightly-munching-cosmos.md","content":"# Plan: Add a \"Hello World\" tooltip to the tab bar\n\n## Context\n..."}
```

---

## 9. Interactive Prompts (AskUserQuestion)

**Replaces:** Terminal output parsing for numbered option prompts.

### Question Schema

`content_block_start` type=`tool_use` name=`AskUserQuestion` followed by stringify with full question:

```json
{"questions":[{"question":"What's your favorite season of the year?","header":"Season","options":[{"label":"Spring","description":"..."},{"label":"Summer","description":"..."},{"label":"Autumn","description":"..."},{"label":"Winter","description":"..."}]}]}
```

### User Answer

Stringify tool result:
```
"User has answered your questions: \"What's your favorite season of the year?\"=\"Spring\"."
```

---

## 10. Session Identity & Metadata

**Replaces:** Process inspection and config file reading.

### 10a. Session Registration (stringify)

```json
{"pid":17004,"sessionId":"de09698e-...","cwd":"C:\\Users\\jorda\\PycharmProjects\\claude_tabs","startedAt":1774524039860,"kind":"interactive","entrypoint":"cli","name":"add-hello-world-tooltip"}
```

### 10b. Custom Title / Agent Name (stringify)

```json
{"type":"custom-title","customTitle":"add-hello-world-tooltip","sessionId":"de09698e-..."}
{"type":"agent-name","agentName":"add-hello-world-tooltip","sessionId":"de09698e-..."}
```

### 10c. Account Info (stringify)

```json
{"accountUuid":"8e3d1d24-...","emailAddress":"sensis@gmail.com","billingType":"stripe_subscription","displayName":"Jordan","subscriptionType":"max","rateLimitTier":"default"}
```

### 10d. Startup Config (stringify)

```json
{"entrypoint":"cli","permissionMode":"bypassPermissions","numAllowedTools":93,"worktree":true}
```

---

## 11. Process Health

**Replaces:** External process monitoring.

### 11a. Memory / CPU (stringify, ~1/sec)

```json
{"uptime":42.5,"rss":562814976,"heapTotal":31844352,"heapUsed":39393222,"external":31861682,"arrayBuffers":16884603,"cpuPercent":0}
```

Fields: `rss` (total memory), `heapUsed`/`heapTotal` (V8 heap), `uptime` (seconds), `cpuPercent`.

### 11b. Rate Limit Status (stringify)

```json
{"status":"allowed_warning","hoursTillReset":16}
```

---

## 12. Conversation Tree

**Replaces:** JSONL conversation file reading for history.

Both user and assistant messages are serialized via stringify with full threading:

```
user:  uuid=f9436a29, parentUuid=null        (root)
asst:  uuid=...,      parentUuid=f9436a29    (response to root)
user:  uuid=8435de4c, parentUuid=null        (new turn)
asst:  uuid=...,      parentUuid=8435de4c    (response)
  subagent: uuid=14fddde7, parentUuid=..., isSidechain=true, agentId=...
```

Each message includes: `uuid`, `parentUuid`, `promptId`, `isSidechain`, `agentId`, `permissionMode`, `cwd`, `sessionId`, `version`, `gitBranch`.

---

## 13. Hook Execution

**Replaces:** Monitoring hook processes externally.

### Progress Events (stringify)

```json
{"type":"progress","data":{"type":"hook_progress","hookEvent":"PostToolUse","hookName":"PostToolUse:Write","command":"Type-checking...","statusMessage":"Type-checking..."}}
```

### Hook Environment (stringify)

```json
{"session_id":"de09698e-...","transcript_path":"...","cwd":"...","permission_mode":"plan","hook_event_name":"PostToolUse","tool_name":"Write","tool_input":"...","tool_response":"..."}
```

---

## 14. File Tracking

**Replaces:** Git status polling for detecting which files Claude modified.

### File Create/Modify Events (stringify)

```json
{"type":"create","filePath":"C:\\Users\\jorda\\.claude\\plans\\sprightly-munching-cosmos.md","content":"# Plan: Add..."}
```

### File History Snapshots (stringify)

```json
{"type":"file-history-snapshot","messageId":"f9436a29-...","snapshot":{"trackedFileBackups":{"C:\\...\\cosmos.md":{"version":1}}}}
```

---

## 15. Turn Duration (stringify)

```json
{"type":"system","subtype":"turn_duration","durationMs":33938,"messageCount":8}
```

Total duration and message count for a complete turn (user input through final response).

---

## 16. Feature Flags

Available features can be detected from stringify:

```json
{"tengu_marble_whisper":true,"tengu_cobalt_compass":true,...}
```

And feature rollout counters:
```json
{"plan-mode":1169,"custom-agents":1160,"permissions":1155,...}
```

---

## Signal Reliability

| Signal Source | Delivery | Latency | Reliability |
|---------------|----------|---------|-------------|
| parse (SSE events) | Push via JSON.parse hook | <1ms from API | Every event, ordered |
| stringify (outgoing) | Push via JSON.stringify hook | <1ms from serialization | Every event, ordered |
| fetch | Push via fetch hook | After response completes | One per API call |

All signals arrive in the tap buffer within 1ms of the underlying operation. The 500ms poll interval of `useTapRecorder` adds latency, but this is configurable.

---

## Known Issues

### Bun.spawn cmd field broken

All 7 `bun.spawn` entries log `cmd: "[object Object]"` instead of the actual command. Bun.spawn receives a single options object `{cmd: [...], cwd: ...}` rather than `(arrayOfArgs, opts)`. The hook needs to handle this form.

### Snap truncation at 2,000 chars

Large API request bodies (42KB-114KB) are truncated. This affects full conversation context visibility but not state detection (the critical fields are in the first 2K). For full conversation tracking, use the conversation message events instead.

### stringify noise

753 stringify entries in this session. Roughly 50% are low-value: bare strings (property keys), booleans, numbers, and repeated telemetry. The high-value entries (conversation messages, tool inputs, API telemetry, user input) are ~200 of the 753. Could be filtered by snap length or structure.
