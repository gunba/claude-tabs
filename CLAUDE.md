# Claude Tabs

Tauri v2 desktop app managing multiple Claude Code CLI sessions in tabs. Rust backend + React/TypeScript frontend. No API key — uses the Claude Code CLI directly.

```
React UI (WebView2) ←→ Tauri IPC ←→ Rust Backend ←→ ConPTY ←→ Claude Code CLI
```

## Build & Validate

```bash
npm run build:quick     # Release binary, no installer (~30s after first build)
npm run build:debug     # Debug binary, fastest (~10-15s incremental)
npm run tauri dev       # Dev mode with hot-reload (frontend only, Rust recompiles on change)
npm run tauri build     # Full NSIS installer (only for releases)
```

Portable exe: `src-tauri/target/release/claude-tabs.exe` (quick) or `src-tauri/target/debug/claude-tabs.exe` (debug). Never do a full NSIS build just to test.

**Before every commit:**
```bash
npx tsc --noEmit           # Zero TypeScript errors
npm test                   # All Vitest unit tests pass
cargo check (in src-tauri) # Zero Rust errors
```

## Manual Testing (MANDATORY)

You MUST personally test every change before delivering. Do NOT guess at fixes or theorize without evidence.

1. Add logging/instrumentation to observe actual behavior
2. Launch the app (`build:quick` or `tauri dev`) and reproduce the issue
3. Read `%LOCALAPPDATA%/claude-tabs/test-state.json` to understand what's happening
4. Make a targeted fix based on observed evidence
5. Re-run the same reproduction to verify the fix works

**For visual issues that the test harness can't observe, take a screenshot and visually inspect.**
If the test harness can't observe a non-visual issue, EXTEND IT. Never say "I can't test this."

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Tab Bar  [● session1 | ● session2 | + ]                      │
├──────────────────────────────────────────────────────────────┤
│ Subagent Bar  [▐ agent-task-1  12K] [▐ agent-task-2  8K]     │
├────────────────────────────────────┬─────────────────────────┤
│  Terminal (xterm.js 6.0)           │  ActivityFeed           │
│  (CSS display toggle, not unmount) │  (actions log)          │
├────────────────────────────────────┴─────────────────────────┤
│ Command Bar (slash commands)                                  │
├──────────────────────────────────────────────────────────────┤
│ StatusBar (model, cost, tokens, duration)                     │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

1. User types in xterm.js → `onData` → PTY `write` → ConPTY → Claude stdin
2. Claude stdout → ConPTY → `tauri-pty` npm `onData` → `Uint8Array`
3. PTY data handler: `writeBytes(data)` to xterm.js (debounce-batched, 4ms/50ms) + `feed(text)` for permission detection
4. Background tabs: PTY data buffered in `bgBufferRef`, flushed as single write on tab focus (O(1) rendering)
5. Rust JSONL watcher tails `~/.claude/projects/{encoded_dir}/{session}.jsonl` → Tauri events → `useClaudeState` → Zustand store
6. Resumed sessions: fast two-point scan (first 30 + last 100 lines from final 256KB), skip middle — O(1) not O(file)
7. React re-renders from store: tab state dots, status bar, activity feed, subagent cards

### Subsystems

| Subsystem | Implementation | Notes |
|-----------|---------------|-------|
| **PTY** | `tauri-plugin-pty` (Rust) + `tauri-pty` npm | Omit `env` to inherit (never pass `env: {}`) |
| **Terminal** | xterm.js 6.0 + WebGL + FitAddon | DEC 2026 sync output prevents ink flash |
| **State detection** | JSONL-based (Rust watcher) | PTY scan only for permission/idle detection |
| **Persistence** | `%LOCALAPPDATA%/claude-tabs/sessions.json` | Frontend-owned via `persist_sessions_json`; `beforeunload` flush |
| **Settings** | Zustand + `localStorage` | Recent dirs, CLI capabilities, command usage |
| **Discovery** | `claude --help` + binary scan + plugin/skill file scan | `--help` fallback when binary unavailable |
| **Colors** | Sequential assignment in `claude.ts` | Avoids collisions, preserved across revival |
| **Background buffering** | `visibleRef` + `bgBufferRef` in TerminalPanel | Buffered when hidden, flushed on focus |
| **Scrollback** | `useTerminal` onScroll handler | 5K default, grows 10K on scroll-to-top, shrinks at bottom |
| **Dir encoding** | `encode_dir()` — all non-alphanumeric → hyphen | `decode_project_dir()` probes filesystem to resolve ambiguity |
| **Plan-mode continuation** | `find_continuation_session` + `onConversationEnd` | Detects new JSONL file via embedded sessionId, restarts watcher |

### Rust Commands

| Command | Purpose |
|---------|---------|
| `create_session` / `close_session` | Session CRUD |
| `build_claude_args` | SessionConfig → CLI args (`--resume`, `--session-id`, `--project-dir`, etc.) |
| `start_jsonl_watcher` / `stop_jsonl_watcher` | Tail JSONL files, emit events (fast scan for resumed sessions) |
| `start_subagent_watcher` / `stop_subagent_watcher` | Watch subagent JSONL directory |
| `find_continuation_session` | Detect plan-mode forks via sessionId in first events of other JSONL files |
| `detect_claude_cli` / `check_cli_version` / `get_cli_help` | CLI discovery |
| `list_past_sessions` | Scan `~/.claude/projects/` for resumable sessions (async, `spawn_blocking`) |
| `get_first_user_message` | Read first user message from session JSONL |
| `persist_sessions_json` / `load_persisted_sessions` | Save/restore sessions |
| `discover_builtin_commands` / `discover_plugin_commands` | Slash command discovery |
| `discover_hooks` / `save_hooks` | Hook configuration |

### Frontend Structure

```
src/
├── App.tsx                              # Root: tab bar, subagent bar, terminals, activity feed
├── store/sessions.ts                    # Zustand: sessions, active tab, subagents
├── store/settings.ts                    # Zustand: preferences, CLI info (persisted to localStorage)
├── hooks/
│   ├── useTerminal.ts                   # xterm.js lifecycle, write batching, dynamic scrollback
│   ├── usePty.ts                        # PTY spawn (tauri-pty npm wrapper)
│   ├── useClaudeState.ts               # JSONL events, permission scan, first message, plan-mode continuation
│   ├── useSubagentWatcher.ts            # Subagent JSONL tracking, local elapsed timer
│   ├── useCommandDiscovery.ts           # Slash command discovery (binary scan + --help fallback + plugins)
│   ├── useCliWatcher.ts                 # CLI version + capabilities
│   └── useNotifications.ts              # Desktop notifications
├── components/
│   ├── Terminal/TerminalPanel.tsx        # PTY + terminal + JSONL watcher + background buffering
│   ├── ActivityFeed/ActivityFeed.tsx     # Action-oriented feed (state changes, tool uses, subagents)
│   ├── SessionLauncher/SessionLauncher.tsx  # New/resume session modal
│   ├── ResumePicker/ResumePicker.tsx     # Browse past sessions to resume
│   ├── CommandBar/CommandBar.tsx         # Slash commands with usage-based sorting
│   ├── StatusBar/StatusBar.tsx           # Model, cost, tokens, duration
│   ├── CommandPalette/CommandPalette.tsx # Ctrl+K search
│   ├── SubagentInspector/SubagentInspector.tsx  # Markdown-rendered subagent conversation viewer
│   └── HooksManager/HooksManager.tsx    # Hook configuration UI
├── lib/
│   ├── jsonlState.ts                    # JSONL state machine (state + cost + metadata + first message)
│   ├── claude.ts                        # Color assignment, dirToTabName, formatTokenCount
│   ├── theme.ts                         # Theme definitions, CSS variable setter, xterm theme
│   ├── ptyRegistry.ts                   # Global PTY writer registry
│   ├── terminalRegistry.ts             # Terminal buffer reader registry
│   ├── testHarness.ts                   # Test bridge (writes state to JSON, accepts commands)
│   ├── uiConfig.ts                     # Persisted UI configuration
│   └── perfTrace.ts                    # Performance tracing utilities
└── types/session.ts                     # TypeScript types mirroring Rust (camelCase)
```

### Theme System

All colors are CSS custom properties on `:root` — components never use hardcoded hex. Applied at startup via `applyTheme()`. xterm.js colors from `getXtermTheme()` reading CSS variables.

Key variables: `--bg-primary`, `--bg-surface`, `--accent` (clay), `--accent-secondary` (blue), `--accent-tertiary` (purple), `--term-bg`, `--term-fg`.

## Development Rules

### Code Organization
- Rust IPC commands in `commands.rs`, registered in `lib.rs` via `generate_handler!`
- TypeScript types in `src/types/` mirror Rust types with camelCase
- Zustand stores in `src/store/`, hooks in `src/hooks/`
- Components in `src/components/<Name>/<Name>.tsx` with co-located CSS
- Add tests for any new pure-logic functions in `src/lib/`

### Subprocess Spawns (Rust)
All Rust commands that spawn subprocesses MUST:
1. Use `tokio::task::spawn_blocking()` to avoid blocking the WebView event loop
2. Add `CREATE_NO_WINDOW` flag on Windows (`cmd.creation_flags(0x08000000)`)

### Session Revival
- Resume target: `resumeSession || sessionId || id` (chains through multiple revivals)
- Create new session BEFORE closing old one (avoids visual flash)
- Check JSONL file existence via `session_has_conversation` (not `assistantMessageCount`)
- Skip `--session-id` when using `--resume` or `--continue`
- Preserve color, metadata (nodeSummary, tokens) across revival
- `resumeSession` and `continueSession` are one-shot — never persist in `lastConfig`
- Interrupted sessions (replay ends in thinking/toolUse) force to idle after caught-up
- Historical subagents suppressed during initial replay for resumed sessions

### State Detection
State MUST be derived from real signals (JSONL events, PTY output patterns), never from arbitrary timers. If you can't determine the state from the data, fix the data source.

### Root Cause Fixes Only
Every fix must address the root cause. Never:
- Retry after a delay hoping the second attempt works — fix why the first attempt fails
- Use timers/polling to guess when something happened — find the event that signals it
- Use heuristics when deterministic linking is possible (e.g. Claude Code embeds the old sessionId in continued session JSONL — use that, don't scan by timestamp)
- Increase buffer sizes instead of implementing proper lazy loading

### DO NOT (things that broke before)
- **DO NOT** use timers/timeouts to infer session state
- **DO NOT** use Tauri event listeners for PTY data — use `tauri-pty` npm wrapper
- **DO NOT** use React `key=` to swap terminals — destroys xterm.js + PTY
- **DO NOT** pass `env: {}` to PTY spawn — wipes environment
- **DO NOT** conditionally render stateful components (xterm.js) — use CSS `display:none`
- **DO NOT** put React hooks after conditional early returns
- **DO NOT** let `CLAUDECODE` env var leak into spawned PTYs
- **DO NOT** use `|| []` in Zustand selectors — creates new references, causes render storms
- **DO NOT** sync Rust subprocess spawns on main thread — blocks WebView
- **DO NOT** seed ActivityFeed with persisted state on startup — users see it as noise
- **DO NOT** persist sessions from Rust session manager — metadata is stale, frontend owns persistence
- **DO NOT** persist `resumeSession`/`continueSession` in `lastConfig` — causes launcher to stick in resume mode
- **DO NOT** fix terminal flash by removing WebGL or memoizing useTerminal — fix is xterm.js 6.0 DEC 2026 sync + batching
- **DO NOT** use xterm.js 5.x — v6.0 required for synchronized output
- **DO NOT** set xterm.js scrollback on every onScroll event — triggers buffer reconstruction

## Test Harness

`src/lib/testHarness.ts` writes app state to `%LOCALAPPDATA%/claude-tabs/test-state.json` every 2s and polls for commands from `test-commands.json`.

```bash
cat "$LOCALAPPDATA/claude-tabs/test-state.json"
```

Contains: session count/states/metadata/colors, CLI version, slash commands, active tab, subagents, activity feed entries, console logs.

Commands: `createSession`, `closeSession`, `reviveSession`, `setActiveTab`, `getSubagents`, `listSessions`, `sendInput`.

To extend: add state to `captureState()` in `testHarness.ts`, or add command handlers in the polling loop.

## Unit Tests

`jsonlState` 50, `claude` 23, `deadSession` 18, `theme` 4, `ptyRegistry` 6 — run with `npm test`.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New session |
| `Ctrl+W` | Close active tab |
| `Ctrl+R` | Resume from history |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle tabs |
| `Ctrl+1-9` | Jump to tab N |
| `Ctrl+K` | Command palette |
| `Esc` | Close modal / dismiss inspector |
