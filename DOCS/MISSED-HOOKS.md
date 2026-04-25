# Missed Global Hooks — Claude Code Tap Coverage Analysis

Date: 2026-04-02

Analysis of Claude Code source (`C:\Users\jorda\PycharmProjects\claude_code`) versus Code Tabs tap implementation (`src/lib/inspectorHooks.ts`) to identify unhooked globals that could provide additional data.

---

## Currently Hooked (15 categories in INSTALL_TAPS)

| # | Global | Methods wrapped | Data captured |
|---|--------|----------------|---------------|
| 1 | `JSON.parse` | `.parse()` | All deserialized JSON (SSE frames, config, IPC) |
| 2 | `JSON.stringify` | `.stringify()` | All serialized JSON (API requests, state, telemetry) |
| 3 | `console` | `.log()`, `.warn()`, `.error()` | Internal debug output |
| 4 | `fs` (sync only) | `readFileSync`, `writeFileSync`, `existsSync`, `statSync`, `readdirSync` | Synchronous file I/O |
| 5 | `child_process` | `spawn`, `exec`, `spawnSync`, `execSync` | Subprocess spawning with exit tracking |
| 6 | `globalThis.fetch` | Full wrapper | HTTP requests/responses with headers, timing |
| 7 | `process.exit` | `.exit()` | Process termination |
| 8 | `setTimeout` / `clearTimeout` | Both | Timer registration/cancellation |
| 9 | `process.stdout.write` | `.write()` | Raw Ink terminal output |
| 10 | `process.stderr.write` | `.write()` | Error output |
| 11 | `Module.prototype.require` | `.require()` | Module loading |
| 12 | `Bun.write` / `Bun.spawn` / `Bun.spawnSync` | All three | Bun-native file writes and process spawning |
| 13 | `WebSocket` | Constructor + `.send()`, `.close()` | WebSocket lifecycle |
| 14 | `net.createConnection` / `tls.connect` | Both | Raw TCP/TLS connections |
| 15 | `stream.Readable.prototype.pipe` | `.pipe()` | Stream piping |

### Existing always-on patches in INSTALL_TAPS

| Global | What it captures |
|--------|-----------------|
| `https.request` | WebFetch domain blocklist bypass + 90s hard timeout |
| `globalThis.fetch` (second wrap) | 120s timeout for non-streaming Anthropic API calls |

---

## Missed Globals — High Value

### 1. `TextDecoder.prototype.decode`

**What it captures:** Every `Uint8Array` → string conversion, including raw SSE chunks from the Anthropic API.

**Why it matters:** SSE streaming data flows: `fetch response → reader.read() → TextDecoder.decode(chunk) → SSE line splitting → JSON.parse`. Currently only the `JSON.parse` step is captured, meaning data is only visible after full JSON objects are assembled. TextDecoder gives **token-level streaming visibility** — partial text as it arrives character by character, not just after complete JSON assembly.

**Data not available elsewhere:**
- Partial/incomplete SSE frames
- Non-JSON SSE frames (`data: [DONE]`, `event: message_start` type lines)
- Raw byte-level timing of streaming output

**Hook approach:**
```javascript
var OrigTextDecoder = TextDecoder;
var origDecode = TextDecoder.prototype.decode;
TextDecoder.prototype.decode = function(input, options) {
  var result = origDecode.apply(this, arguments);
  if (/* filter for SSE chunks */) {
    push('textdecoder', { len: result.length, snap: result.slice(0, 2000) });
  }
  return result;
};
```

**Expected call volume:** High — every SSE chunk from the Anthropic API passes through here.

---

### 2. `ReadableStreamDefaultReader.prototype.read`

**What it captures:** The `response.body.getReader().read()` loop that consumes the SSE stream.

**Why it matters:** Same data as TextDecoder but at the stream-chunk boundary level. Shows SSE framing (`data: {...}` lines) before JSON parsing. Captures the full chunk structure including multiple SSE events in a single read.

**Data not available elsewhere:**
- SSE frame boundaries (where one event ends and another begins)
- Chunks containing multiple SSE events
- The `done: true` signal marking stream end

**Hook approach:**
```javascript
var origRead = ReadableStreamDefaultReader.prototype.read;
ReadableStreamDefaultReader.prototype.read = function() {
  return origRead.apply(this, arguments).then(function(result) {
    if (result.value) {
      push('stream.read', { done: result.done, len: result.value.length || result.value.byteLength || 0 });
    }
    return result;
  });
};
```

**Expected call volume:** High — once per SSE chunk.

---

### 3. `fs.promises.readFile` / `fs.promises.writeFile` (and other async fs methods)

**What it captures:** All asynchronous file I/O operations.

**Why it matters:** Only sync fs methods are currently hooked (`readFileSync`, `writeFileSync`, etc.). Claude Code reads conversation transcripts, tool outputs, and config files asynchronously — those reads are completely invisible to the current tap. This is the **largest coverage gap** for file operations.

**Claude Code usage patterns (from source):**
- `fs.promises.readFile` — reading conversation history JSONL, config files, tool output files
- `fs.promises.writeFile` — writing conversation state, telemetry
- `fs.promises.mkdir` — creating directories for new sessions
- `fs.promises.rm` — cleanup operations
- `fs.promises.access` — checking file existence asynchronously
- `fs.promises.appendFile` — appending to log/transcript files

**Hook approach:**
```javascript
var fsp = require('fs').promises;
var origReadFile = fsp.readFile;
fsp.readFile = function(path, options) {
  var t0 = Date.now();
  return origReadFile.apply(this, arguments).then(function(result) {
    if (flags.fs) {
      var p = typeof path === 'string' ? path : String(path);
      push('fs.promises.readFile', { path: p.slice(-200), size: result.length || result.byteLength || 0, dur: Date.now() - t0 });
    }
    return result;
  });
};
// Similar for writeFile, mkdir, rm, access, appendFile
```

**Expected call volume:** Medium — several reads/writes per turn.

---

### 4. `Bun.file()` instance methods (`.text()`, `.json()`, `.write()`, `.exists()`, `.stat()`)

**What it captures:** Bun's native file API — the preferred file I/O path in Bun applications.

**Why it matters:** Bun encourages `Bun.file(path).text()` over `fs.readFileSync()`. Any file reads going through this path are invisible. `Bun.write` is already hooked but `Bun.file()` instance methods are not.

**Hook approach:**
```javascript
var origBunFile = Bun.file;
Bun.file = function(path) {
  var file = origBunFile.apply(Bun, arguments);
  // Wrap .text(), .json(), .write(), .exists(), .stat() on the returned BunFile
  var origText = file.text.bind(file);
  file.text = function() {
    var t0 = Date.now();
    return origText().then(function(result) {
      if (flags.fs) {
        push('bun.file.text', { path: String(path).slice(-200), size: result.length, dur: Date.now() - t0 });
      }
      return result;
    });
  };
  // Similar for .json(), .write(), .exists(), .stat()
  return file;
};
```

**Expected call volume:** Medium — depends on how heavily Claude Code uses Bun-native vs Node-compat fs.

---

### 5. `EventEmitter.prototype.emit` (via `require('events')`)

**What it captures:** All internal event dispatching through Node's EventEmitter. Claude Code's hook system uses a dedicated EventEmitter (`hookEvents.ts`) that fires:
- `HookStarted` — `{ hookId, hookName, hookEvent }`
- `HookProgress` — `{ hookId, hookName, hookEvent, stdout, stderr, output }` (streaming)
- `HookResponse` — `{ hookId, hookName, hookEvent, exitCode, outcome }` (success/error/cancelled)

**Why it matters:** These events never go through `JSON.stringify` — they're synchronous in-process dispatch via `EventEmitter.emit()`. This is the **only way** to capture the hook execution lifecycle with per-hook correlation IDs and streaming stdout/stderr. The current `HookProgress` tap event comes from internal telemetry serialization (the `rh`-based path), which lacks per-hook granularity.

Additionally, the Ink UI framework uses EventEmitter for its own events (keyboard, focus, terminal events), which could provide additional UI state visibility.

**Hook approach:**
```javascript
var EventEmitter = require('events').EventEmitter;
var origEmit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function(type) {
  if (flags.events && type !== 'newListener' && type !== 'removeListener') {
    var args = [];
    for (var i = 1; i < arguments.length; i++) {
      try { args.push(origStringify(arguments[i]).slice(0, 500)); } catch(e) { args.push('[circular]'); }
    }
    push('emit', { type: type, args: args, src: this.constructor.name });
  }
  return origEmit.apply(this, arguments);
};
```

**Expected call volume:** Very high — every Ink render cycle and hook execution fires events. Would need careful filtering.

---

## Missed Globals — Medium Value

### 6. `process.env` (as Proxy)

**What it captures:** Every environment variable read.

**Data provided:**
- Which env vars Claude Code checks and when
- `ANTHROPIC_API_KEY` access patterns
- `CLAUDE_*` configuration variables
- Feature flag checks (`CLAUDE_CODE_ENABLE_*`)
- Regional endpoint detection
- Debug/logging flags

**Hook approach:**
```javascript
var origEnv = process.env;
process.env = new Proxy(origEnv, {
  get: function(target, prop) {
    var val = target[prop];
    if (typeof prop === 'string' && prop.length > 0) {
      push('env.read', { key: prop, hasValue: val !== undefined });
    }
    return val;
  }
});
```

**Expected call volume:** Very high at startup, then moderate. Would need rate limiting or key filtering.

---

### 7. `AbortController.prototype.abort`

**What it captures:** Request cancellations — when Claude Code aborts API requests.

**Data provided:**
- When the user presses Escape and the API stream is interrupted
- Timeout-triggered aborts
- Programmatic cancellations from internal logic

**Hook approach:**
```javascript
var origAbort = AbortController.prototype.abort;
AbortController.prototype.abort = function(reason) {
  if (flags.net) {
    push('abort', { reason: String(reason || '').slice(0, 200) });
  }
  return origAbort.apply(this, arguments);
};
```

**Expected call volume:** Low — only on user interruption or timeout.

---

### 8. `fs.watch` / `fs.watchFile`

**What it captures:** File watcher registrations — which files/directories Claude Code monitors.

**Data provided:**
- Which files trigger `FileChanged` hook events
- Directory watching for config changes
- File monitoring for the `InstructionsLoaded` lifecycle

**Hook approach:**
```javascript
var origWatch = fs.watch;
fs.watch = function(path, options, listener) {
  if (flags.fs) {
    push('fs.watch', { path: String(path).slice(-200) });
  }
  return origWatch.apply(this, arguments);
};
```

**Expected call volume:** Low — watchers are registered once and persist.

---

### 9. `process.on` (signal/event listener registration)

**What it captures:** Process-level event listeners: SIGINT, SIGTERM, `uncaughtException`, `unhandledRejection`.

**Data provided:**
- Signal handling setup (SIGINT for graceful shutdown)
- Error boundary registration
- Process lifecycle awareness

**Hook approach:**
```javascript
var origProcessOn = process.on;
process.on = function(event, handler) {
  if (flags.process) {
    push('process.on', { event: String(event).slice(0, 50) });
  }
  return origProcessOn.apply(this, arguments);
};
```

**Expected call volume:** Very low — only at startup.

---

### 10. `crypto.randomUUID`

**What it captures:** UUID generation for session IDs, message UUIDs, tool use IDs.

**Data provided:**
- Correlation between internally generated IDs and events seen through JSON.parse
- Session ID creation timing
- Message UUID assignment

**Hook approach:**
```javascript
var origUUID = crypto.randomUUID;
crypto.randomUUID = function() {
  var result = origUUID.apply(crypto, arguments);
  if (flags.crypto) {
    push('crypto.uuid', { id: result });
  }
  return result;
};
```

**Expected call volume:** Moderate — several UUIDs per conversation turn.

---

## Missed Globals — Lower Priority

| Global | What it captures | Why lower priority |
|--------|-----------------|-------------------|
| `Buffer.from` | Buffer construction from strings/arrays | Very high volume, mostly noise. Data already captured at source (stringify/fs). |
| `performance.now()` | Internal timing measurements | Already getting timing from fetch/fs/spawn hooks. |
| `atob` / `btoa` | Base64 encoding/decoding | Likely used for MCP communication; narrow use case. |
| `structuredClone` | Deep cloning of objects | Internal implementation detail, no unique data. |
| `TextEncoder.prototype.encode` | String → Uint8Array encoding | Reverse of TextDecoder; less useful for data extraction. |

---

## Claude Code Hook Events Not Classified in tapClassifier

These events flow through `JSON.stringify` when hooks are configured, but the `tapClassifier` does not have patterns to recognize them. They would appear as uncategorized stringify events.

| Hook Event | Data | Current visibility |
|------------|------|--------------------|
| `SessionEnd` | `reason` (clear/resume/logout/prompt_input_exit/other) | Not classified |
| `PostToolUseFailure` | `tool_name`, `tool_input`, `error`, `is_interrupt` | Not classified |
| `Stop` | `stop_hook_active`, `last_assistant_message` | Not classified |
| `StopFailure` | `error`, `error_details`, `last_assistant_message` | Not classified |
| `PreCompact` | `trigger` (manual/auto), `custom_instructions` | Not classified |
| `PostCompact` | `trigger`, `compact_summary` | Not classified |
| `InstructionsLoaded` | `file_path`, `memory_type`, `load_reason`, `globs` | Not classified |
| `ConfigChange` | `source`, `file_path` | Not classified |
| `CwdChanged` | `old_cwd`, `new_cwd` | Not classified |
| `FileChanged` | `file_path`, `event` (change/add/unlink) | Not classified |
| `Notification` | `message`, `title`, `notification_type` | Not classified |
| `SubagentStop` | `agent_id`, `agent_type`, `agent_transcript_path` | Not classified (SubagentLifecycle partially covers) |
| `Elicitation` | `mcp_server_name`, `message`, `requested_schema` | Not classified |
| `ElicitationResult` | `mcp_server_name`, `action`, `content` | Not classified |
| `TeammateIdle` | `teammate_name`, `team_name` | Not classified |
| `TaskCreated` | `task_id`, `task_subject`, `task_description` | Not classified |
| `TaskCompleted` | `task_id`, `task_subject`, `task_description` | Not classified |
| `WorktreeCreate` | `name` | Not classified (WorktreeState partially covers) |
| `WorktreeRemove` | `worktree_path` | Not classified (WorktreeCleared partially covers) |
| `Setup` | `trigger` (init/maintenance) | Not classified |

**Important caveat:** These hook events only serialize through `JSON.stringify` when hooks are actually configured for that event name. If no user hooks are registered for `SessionEnd`, the serialization never happens. This means they are unreliably captured. The global hooks above (TextDecoder, EventEmitter, async fs) capture data regardless of hook configuration.

---

## Recommended Implementation Priority

1. **`TextDecoder.prototype.decode`** — Easiest win for streaming text visibility
2. **`EventEmitter.prototype.emit`** — Opens the internal event bus
3. **`fs.promises.*`** + **`Bun.file()` methods** — Closes the async I/O gap
4. **`AbortController.prototype.abort`** — Small, clean hook for cancellation tracking
5. **`process.env` Proxy** — Config visibility (needs rate limiting)
6. **`fs.watch`** — Watch registration tracking
7. **tapClassifier additions** — Classify the 20 unhandled hook event shapes
