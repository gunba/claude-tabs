# Claude Tabs — Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│  React UI (WebView2)                                         │
│  Tab Bar (dense: state dot + name + model + close)           │
│  Subagent Bar (full-width cards, animated borders)           │
│  Terminal ← xterm.js (main view)                             │
│  ActivityFeed (IRC-style right pane, ~20% width)             │
│  SessionLauncher (icon-driven)                              │
│  StatusBar (model, cost, context %)                         │
└───────────────┬──────────────────────────────────────────────┘
                │ Tauri IPC (invoke + events)
┌───────────────▼──────────────────────────────────────────────┐
│  Rust Backend                                                │
│  SessionManager (HashMap<Id, Session>)                       │
│  invoke_claude_pipe (one-shot pipe mode for Haiku)           │
│  CLI detection, spawn config, session persistence            │
└───────────────┬──────────────────────────────────────────────┘
                │ ConPTY (Windows native)
┌───────────────▼──────────────────────────────────────────────┐
│  Claude Code CLI processes (one per session)                 │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

1. User types in xterm.js terminal
2. xterm.js `onData` callback fires, sending keystrokes to PTY via `plugin:pty|write`
3. tauri-plugin-pty writes to ConPTY, which feeds Claude Code's stdin
4. Claude Code produces output on stdout → ConPTY → tauri-plugin-pty
5. `tauri-pty` npm wrapper polls PTY for data internally (NOT Tauri events — the plugin does not emit events)
6. `onData` callback receives output bytes as `number[]` (JSON-serialized `Vec<u8>`), converts to `Uint8Array`, writes to xterm.js AND feeds to state detector
7. State detector heuristically parses output → updates Zustand store (with JSON fingerprint change detection to reduce re-render churn)
8. React components re-render: session node state icons, status bar, etc.

## Theme System

All colors are defined as CSS custom properties on `:root`. Components never use hardcoded hex values.

```
index.html      :root { --bg-primary: #1a1917; ... }  ← defaults
main.tsx        applyTheme(CLAUDE_THEME)               ← runtime override
theme.ts        Theme type, CLAUDE_THEME, applyTheme(), getXtermTheme()
*.css           var(--bg-primary), var(--accent), etc.
useTerminal.ts  getXtermTheme() for xterm.js colors
```

### Color Roles

| Variable | Role | Cowork Value |
|----------|------|-------------|
| `--bg-primary` | Main background | `#1f1e1c` (Cowork bg-200) |
| `--bg-surface` | Elevated surfaces | `#262523` (Cowork bg-100) |
| `--bg-surface-hover` | Surface hover | `#302f2c` (Cowork bg-000) |
| `--bg-hover` | Interactive hover states | `#302f2c` (alias for surface-hover) |
| `--bg-selection` | Selected items | `#302f2c` |
| `--border` | Primary borders | `#3d3a36` |
| `--text-primary` | Primary text | `#f9f7f3` (Cowork text-100) |
| `--text-secondary` | Secondary text | `#bfbdb7` (Cowork text-200) |
| `--text-muted` | Muted text | `#9a9893` (Cowork text-400) |
| `--accent` | Brand accent | `#d4744a` (Cowork clay) |
| `--accent-hover` | Accent hover | `#e08b67` |
| `--accent-bg` | Accent background | `#3d2a20` |
| `--accent-secondary` | Secondary accent | `#6ea8e0` (Cowork blue) |
| `--accent-tertiary` | Tertiary accent | `#bc8cff` (purple, tool banners) |

To add a new theme: create a `Theme` object in `theme.ts` and call `applyTheme()`.

## Layout System

The app uses a terminal-first layout. The terminal is always the primary view — there is no canvas intermediary.

### Terminal-First Layout
```
┌──────────────────────────────────────────────────────────────┐
│ Tab Bar  [● session1 | ● session2 | ● session3 |  + ]       │
├──────────────────────────────────────────────────────────────┤
│ Subagent Bar  [▐ agent-task-1  12K] [▐ agent-task-2  8K]    │
├────────────────────────────────────────────┬─────────────────┤
│  Terminal (xterm.js)                       │  ActivityFeed   │
│  (active session, always visible)          │  (IRC-style,    │
│                                            │   ~20% width,   │
│                                            │   timestamped   │
│                                            │   events)       │
├────────────────────────────────────────────┴─────────────────┤
│ StatusBar                                                    │
└──────────────────────────────────────────────────────────────┘
```

- `App.tsx` renders: tab bar, subagent bar, terminal + activity feed side-by-side, status bar
- Tab bar is dense: state dot + session name + model badge + inline close button per tab. `+` button at right end
- Dead tabs shown faded in tab bar, clickable to revive
- Subagent bar shows full-width cards with animated left border for active subagents
- ActivityFeed is an IRC-style right pane showing state changes, Haiku summaries, name changes, session lifecycle events
- Empty state shows terminal-black background with "Press Ctrl+T" hint
- Escape only dismisses modals/inspector

## Haiku Summariser

The Haiku summariser runs as a background hook (`useMetaAgent.ts`) that periodically summarizes active sessions and updates their `nodeSummary` metadata.

- **One-shot pipe mode**: Each invocation spawns `claude -p --model haiku` via the `invoke_claude_pipe` Rust command. No persistent session.
- **Contextual triggers**: Fires on session state transitions (thinking/toolUse → idle), session add/remove, and every 10 assistant messages (drift re-summarization).
- **15-second debounce**: Prevents excessive API calls during rapid state changes.
- **Fingerprint-based change detection**: `sessionFingerprint()` in `metaAgentUtils.ts` creates a compact hash of session states. Skips invocation when nothing has changed.
- **Smart naming**: Generates 2-4 word names for sessions still using default directory-basename names.
- **UI config**: `ui-config.json` (loaded once at startup) controls dead session behavior, resume settings, and more. Deep-merged with defaults.

### PTY Registry (`ptyRegistry.ts`)
- Global `Map<string, Function>` mapping session IDs to PTY access functions
- `TerminalPanel` registers on PTY spawn, unregisters on unmount
- Enables accessing a specific session's PTY by session ID

## Rust Backend

### SessionManager (`src-tauri/src/session/mod.rs`)

Thread-safe in-memory store. All fields wrapped in `Mutex`.

- `sessions: HashMap<String, Session>` — all sessions by ID
- `tab_order: Vec<String>` — ordered list of tab IDs
- `active_tab: Option<String>` — currently active tab

The PTY process is managed by `tauri-plugin-pty`, not by our Rust code. We just track the PTY ID for bookkeeping.

### Commands (`src-tauri/src/commands.rs`)

All `#[tauri::command]` functions that the frontend can invoke:

| Command | Purpose |
|---------|---------|
| `create_session` | Create a new session in the manager |
| `close_session` | Remove session from manager |
| `get_session` / `list_sessions` | Query session state |
| `set_active_tab` / `get_active_tab` | Tab switching |
| `reorder_tabs` | Drag-and-drop reorder |
| `update_session_state` | State change from frontend detector |
| `set_session_pty_id` | Link PTY process to session |
| `persist_sessions` / `load_persisted_sessions` | Save/restore |
| `detect_claude_cli` | Find `claude` in PATH |
| `build_claude_args` | Translate SessionConfig → CLI args |
| `invoke_claude_pipe` | Run `claude -p` pipe mode for Haiku summariser (async) |
| `check_cli_version` | Run `claude --version` and return result |
| `get_cli_help` | Run `claude --help` and return capabilities |
| `list_past_sessions` | Scan `~/.claude/projects/` for resumable sessions |
| `read_ui_config` / `write_ui_config` | Read/write `ui-config.json` |

### Persistence (`src-tauri/src/session/persistence.rs`)

Saves `SessionSnapshot[]` as JSON to `%LOCALAPPDATA%/claude-tabs/sessions.json`. On restore, all sessions come back as `Dead` state (PTY is gone). The frontend offers to resume them via `--resume`.

## Frontend

### State Management

Three Zustand stores:

1. **`sessions.ts`** — Session list, active tab, CRUD operations, subagent tracking. Mirrors backend state via IPC.
2. **`settings.ts`** — App preferences, presets, recent directories, theme name, CLI version/capabilities (`cliVersion`, `previousCliVersion`, `cliCapabilities`). Persisted locally.
3. **`uiConfig.ts`** — Shared UI configuration loaded from `ui-config.json`. Deep-merged with defaults, loaded once at startup. Controls dead session behavior, resume settings.

### Hooks

- **`usePty`** — Uses `tauri-pty` npm wrapper to spawn PTY (no `env` override — inherits parent process environment). Returns `PtyHandle` with `write`/`resize`/`kill`.
- **`useTerminal`** — Creates xterm.js Terminal on mount, loads theme from CSS variables via `getXtermTheme()`, attaches WebGL/fit/web-links addons. ResizeObserver handles container resizing.
- **`useClaudeState`** — Feeds PTY output text to `stateDetector`, polls every 500ms for state changes and metadata extraction. Uses JSON fingerprint comparison to detect meaningful changes and reduce re-render churn. Only updates Zustand when state actually changes.
- **`useMetaAgent`** — Haiku summariser hook. Subscribes to Zustand store for contextual triggers (session state transitions, session add/remove). 15-second debounce, fingerprint-based change detection. Uses one-shot `invoke_claude_pipe` per invocation.
- **`useCliWatcher`** — Checks `claude --version` on startup via Rust commands. Parses `--help` for capabilities. Stores version in settings.

### Design Philosophy: Low Text, High Intent

Power users build visual associations, not read labels. The app uses:
- **Icons + tooltips** instead of text labels (state, permission mode, actions)
- **Animations** to convey state (pulse = thinking, spin = tool use, pulse-border = permission)
- **Progress bars** instead of "N/M tasks" text
- **Values only** as text (directory paths, model names, cost amounts)

### Haiku Summariser

See "Haiku Summariser" section above for full details. Summary:
- **Haiku summariser**: Background `useMetaAgent.ts` hook, one-shot pipe mode via `invoke_claude_pipe`, contextual triggers via store subscription, fingerprint-based change detection, 15s debounce
- Sessions have `isMetaAgent` flag (used for filtering) and `nodeSummary` field

### Component Architecture

```
App (terminal-first layout)
├── Tab Bar (dense: state dot + name + model + close, + button at end)
├── Subagent Bar (full-width cards, animated left border, description + tokens)
├── Main Area (flex row)
│   ├── TerminalPanel[] (xterm.js + PTY, CSS display:none toggle, preserves PTY state)
│   │   ├── StateBanner (icon-only floating overlay, hover-visible)
│   │   └── DurationTimer (live counter)
│   └── ActivityFeed (IRC-style right pane, ~20% width, timestamped events)
├── StatusBar (icon-first: model, perm, context, cost, duration)
├── SessionLauncher (minimal modal: path + recent cards + resume cards)
└── CommandPalette (Ctrl+K modal overlay)
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New session (open launcher) |
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle tabs |
| `Ctrl+1-9` | Jump to tab N |
| `Ctrl+K` | Command palette |
| `Enter` (in launcher) | Launch session |
| `Esc` | Close modal / dismiss inspector |

## Tauri Plugins

| Plugin | Purpose |
|--------|---------|
| `tauri-plugin-pty` | ConPTY ↔ WebView bridge |
| `tauri-plugin-shell` | Open URLs |
| `tauri-plugin-process` | Process management |
| `tauri-plugin-log` | Structured logging |
| `tauri-plugin-store` | Key-value persistence |
| `tauri-plugin-window-state` | Remember window position/size |

## Build & Distribution

- `npm run tauri build` → NSIS installer
- `installMode: "currentUser"` → installs to `%LOCALAPPDATA%`, no admin needed
- Binary size: ~5-15MB (WebView2 is pre-installed on Windows 11)

## Testing

- `npm test` — runs 67 Vitest unit tests across 6 files
- `TESTING.md` — manual test checklist for UI behavior
- Tests cover: JSONL state processing (31), CLI arg helpers (14), dead sessions (10), meta-agent utilities (5), theme structure (4), PTY registry (3)

## Performance

- **Metadata change detection**: `useClaudeState` uses JSON fingerprint comparison on extracted metadata, only updating Zustand when the fingerprint changes. Eliminates 500ms re-render churn from polling.
- **Debounced persistence**: State file writes and Haiku summariser calls use debouncing (6s state writes, 15s Haiku) to prevent excessive disk I/O and API calls.
