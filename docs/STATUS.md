# Claude Tabs — Project Status

> Auto-maintained by development agents. Updated after each significant change.

## Current Phase: Phase 8 (Terminal-First Redesign) — Complete

## Build Status

- **Last build**: TypeScript clean, tests passing (67/67)
- **Rust**: Clean (0 warnings)
- **Tests**: 67 unit tests via Vitest across 6 files (jsonlState 31, claude 14, deadSession 10, metaAgentUtils 5, theme 4, ptyRegistry 3)
- **Vite bundle**: Code-split into 2 chunks — index (244KB), xterm (397KB). No single chunk >500KB.

## Completed Work

### Phase 1: Core Tab Manager
- [x] Tauri v2 + React 19 + TypeScript + Vite scaffold
- [x] Rust backend: SessionManager, persistence, CLI detection, arg builder
- [x] PTY management via `tauri-plugin-pty` (using official `tauri-pty` npm API)
- [x] xterm.js terminal with WebGL addon, fit addon, web-links addon
- [x] Tab bar with state indicators (thinking, tool use, idle, error, dead, permission)
- [x] Session launcher with model/permission controls
- [x] Status bar (model, context %, cost, duration, permission mode)
- [x] Command palette (Ctrl+K) — search tabs, run commands
- [x] Keyboard shortcuts: Ctrl+T/W/Tab/1-9/K
- [x] Settings persistence (localStorage via Zustand persist middleware)
- [x] Session persistence (%LOCALAPPDATA%/claude-tabs/sessions.json)
- [x] All terminals render simultaneously (show/hide) — scrollback preserved on tab switch

### Phase 1 Bug Fixes
- [x] Rewrote `usePty.ts` — was using fabricated Tauri events; now uses official `tauri-pty` npm API
- [x] Fixed terminal lifecycle — was destroying/recreating on tab switch. Now renders all terminals with CSS show/hide
- [x] Fixed `useTerminal.ts` — ref callback returning cleanup (not supported). ResizeObserver managed via refs
- [x] Fixed settings persistence — Zustand persist middleware with localStorage
- [x] Fixed React StrictMode double-init — `initRef` guard

### Phase 2: Rich Metadata & Smart Tabs
- [x] ANSI stripping in state detector — strips all escape codes before pattern matching
- [x] Improved state detection patterns — more Claude-specific patterns for prompt, thinking, tool use, permission, error states
- [x] Recency-weighted detection — very recent output (150 chars) prioritized for tool use and errors, wider window (600 chars) for permissions
- [x] Metadata extraction from PTY output — cost ($), context %, subagent count, task progress
- [x] Three zoom levels for tabs: Collapsed (16+), Standard (4-15), Expanded (1-3)
- [x] Standard tab shows: model badge, directory, current action, subagent count
- [x] Expanded tab shows: all of standard + mini terminal preview (last 3 lines) + task progress
- [x] State banner overlay — floating indicator on terminal (top-right) showing current state with tool-specific colors
- [x] Tool-specific banner colors: Bash (green), Write/Edit (purple), Read/Glob/Grep (blue), Agent (magenta)
- [x] Live duration timer — per-session counter updating every second
- [x] Tab drag-and-drop reordering
- [x] Tab context menu (right-click): Close, Close Others, Close All, Copy Session ID
- [x] StatusBar shows permission mode, active session count, budget remaining

### Critical Bug Fix
- [x] **Fix blank terminal on session start** — `tauri-plugin-pty` Rust `read()` returns `Vec<u8>`, which Tauri IPC serializes as a JSON `number[]`. The `tauri-pty` npm package incorrectly types `onData` as `Uint8Array`, but the runtime value is `number[]`. `TextDecoder.decode()` and xterm.js `write()` both require a real `BufferSource`, so every data callback silently threw `TypeError`, rendering nothing. Fixed in `usePty.ts` by converting to `Uint8Array.from()` before forwarding.

### Phase 2.5: Design Rework
- [x] **Fix "Starting" bug** — removed `env: {}` from PTY spawn options (was wiping PATH, HOME, etc.)
- [x] **CSS variable system** — all colors use CSS custom properties (`var(--bg-primary)`, etc.) set on `:root`
- [x] **Claude brand color scheme** — warm dark palette (Cowork design tokens, warm grays, no blue tints)
- [x] **Theme engine** (`src/lib/theme.ts`) — `Theme` type, `applyTheme()` function, `getXtermTheme()` for terminal
- [x] **Session launcher redesign** — minimal modal: path input (autofocus), recent dir cards, icon-only model/permission buttons, Enter to launch
- [x] **Low-text philosophy** — icons + tooltips replace text labels across tab bar, status bar, and state banners
- [x] **Task progress bar** — thin progress bar replaces "N/M tasks" text in tabs
- [x] **Scalable sidebar layout** — horizontal tab bar at 1-5 tabs, left sidebar at 6+ tabs with hover-expand
- [x] **Meta-agent foundation** — `isMetaAgent` flag on Session, star icon rendering, pinned-first positioning, theme control via settings store
- [x] **Testing infrastructure** — Vitest with 37 unit tests (stateDetector, theme, claude.ts) + TESTING.md manual checklist

### Phase 3: Graph Canvas + Meta-Agents
- [x] **Graph canvas** — replaced TabBar with React Flow canvas (`@xyflow/react`) using architect paper background
- [x] **Custom session nodes** — `SessionNode` component renders each session as a React Flow node with state indicators
- [x] **Dagre auto-layout** — `graphLayout.ts` uses dagre to automatically arrange session nodes
- [x] **Single terminal overlay** — clicking a node opens its terminal as a full overlay; Escape dismisses it
- [x] **Haiku meta-agent** — `useMetaAgent.ts` hook provides session summaries via Haiku-tier meta-agent
- [x] **Interactive meta-agent spawn** — command palette action to create meta-agent sessions
- [x] **Session type extensions** — added `metaAgentTier`, `parentSessionId`, `nodeSummary` to both TypeScript and Rust types
- [x] **Settings extensions** — added `metaAgentEnabled`, `metaAgentModel` to settings store
- [x] **App.tsx rewrite** — Canvas replaces TabBar, single terminal overlay replaces show/hide-all pattern
- [x] **Keyboard shortcuts updated** — Escape now dismisses terminal overlay, all other shortcuts preserved
- [x] **TabBar removed** — deleted `TabBar.tsx` and `TabBar.css` (~960 LOC removed)
- [x] **New tests** — 10 unit tests for dagre graph layout (`graphLayout.test.ts`)

### Phase 3 UX Fixes
- [x] **Fix permission mode CLI args** — `accept-edits` and `bypass-permissions` were invalid; changed to `acceptEdits` and `bypassPermissions` to match Claude CLI. Added `dontAsk` mode.
- [x] **Fix UX flow** — App now starts on the canvas grid, not the session launcher. Launcher only shows on Ctrl+T.
- [x] **Fix node click** — Clicking canvas nodes now correctly opens the terminal overlay. Fixed overlay z-index blocking.
- [x] **Remove over-engineering** — Removed MiniMap and Controls from canvas. Clean minimal grid only.
- [x] **Redesign canvas visually** — Professional card design for nodes: subtle shadows, hover lift, clean typography, accent glow for active
- [x] **Meta-agent no longer auto-spawns** — Haiku meta-agent only activates when 2+ sessions running. No longer creates a visible "starting" node.
- [x] **Meta-agent filtered from canvas** — Meta-agent sessions don't appear as nodes on the grid
- [x] **State banner made subtle** — Only visible on hover, smaller, less intrusive
- [x] **Back button polished** — Only visible on terminal hover, transparent by default, subtle appearance
- [x] **Added dontAsk permission mode** — Full permission mode support in Rust, TypeScript, launcher, and status bar

### Phase 3.5: UX Fixes + Meta-Agent Panel
- [x] **Fix terminal persistence** — Terminal overlay now uses CSS `display:none` instead of conditional rendering. All TerminalPanel instances stay mounted when returning to canvas, preserving PTY connections and scrollback.
- [x] **Fix "thinking" state on fresh sessions** — State detector: buffer <200 chars returns `"starting"`, larger buffers fall back to `"thinking"` (not `"starting"`). Only matches thinking from explicit patterns.
- [x] **Refine canvas background** — Switched from `BackgroundVariant.Lines` to `BackgroundVariant.Dots`. Gap increased to 48, size reduced to 0.8. Dot opacity set to 25% for subtle appearance.
- [x] **Disable zoom/scroll, auto-fit** — Canvas now has `panOnDrag={false}`, `zoomOnScroll={false}`, `zoomOnPinch={false}`, `zoomOnDoubleClick={false}`. Auto-fits view when session count changes via `onInit` ref.
- [x] **Close button on nodes** — Hover-visible `×` button in top-right of session nodes. Uses `stopPropagation` to prevent opening terminal. Styled with red hover state.
- [x] **Shannon chat panel** — Right-side panel (340px, collapsible) with custom chat UI for "Shannon" the meta-agent. Uses Sonnet model via `claude -p` pipe mode (Rust `send_shannon_message` async command). Chat bubbles for user/assistant/system messages. Haiku status updates injected as centered "system" badges without being sent to Sonnet. Does NOT steal focus from active terminal. Conversation history included in prompts for continuity.
- [x] **Haiku summariser (contextual)** — `useMetaAgent()` hook runs headless Haiku agent. Triggers contextually via store subscription: on session transitions (thinking/toolUse→idle), session add/remove. 15s debounce, fingerprint tracking to avoid redundant runs. Injects summaries as system messages in Shannon panel via `addMetaAgentMessage`. No file-based intermediary.
- [x] **Enriched session nodes** — Nodes now show duration, context %, cost, subagent count, and task progress as stat chips. Stats row between summary and model badge.
- [x] **Session resume (richer)** — `list_past_sessions` decodes `~/.claude/projects/` encoded directory names back to filesystem paths. Resume cards show project name, decoded directory, file size, and relative date. Resume uses the decoded directory as working directory.
- [x] **Persistent canvas (dead sessions)** — Dead sessions remain on canvas as faded nodes after app restart. Clicking a dead node revives it with `--continue` flag (auto-continues last conversation for that directory). Dead nodes styled with 50% opacity and grayscale filter.
- [x] **`--continue` flag support** — Added `continueSession` field to `SessionConfig` (TypeScript + Rust). `build_claude_args` emits `--continue` when set.
- [x] **CLI update watcher** — `check_cli_version` and `get_cli_help` Rust commands. `useCliWatcher` hook checks on startup, notifies meta-agent panel on version changes.
- [x] **App directory detection** — `get_app_dir` Rust command walks up from exe to find `package.json`. Used by meta-agent to run in the app's source directory.
- [x] **Two-column app layout** — `app-main` flex container splits canvas area and meta-agent panel. Terminal overlay covers only canvas area.
- [x] **File-based control bridge** — `controlBridge.ts` writes `state.json` (app state), reads `commands.jsonl` (meta-agent commands), supports `create-session`, `close-session`, `revive-session`, `set-active`, `close-all`. Polling loop: commands every 2s, state every 6s.
- [x] **Shared UI config system** — `uiConfig.ts` defines `UiConfig` schema (node, canvas, panel, deadSessions, resume sections). Stored at `%LOCALAPPDATA%/claude-tabs/ui-config.json`. Deep-merged with defaults, polled every 3s for hot-reload. SessionNode reads stats/close config, MetaAgentPanel reads panel width/model, Canvas reads background/fit config.
- [x] **Meta-agent system prompt with control capabilities** — Comprehensive prompt includes control bridge docs (state.json, commands.jsonl, ui-config.json paths and formats), CLI version info, active sessions, and investigation instructions.
- [x] **CLI update investigation** — When Claude CLI version changes, meta-agent prompt includes a "CLI UPDATE DETECTED" alert with old→new version, instructing immediate investigation. `previousCliVersion` persisted in settings store.
- [x] **Config-driven node stats** — `ui-config.json` `node.stats` array controls which stat chips appear on session nodes. `node.showCloseButton` toggles close button visibility.
- [x] **Rust commands for bridge** — `read_ui_config`, `write_ui_config`, `get_data_dir_path`, `invoke_claude_pipe` (renamed from `send_shannon_message`) in `commands.rs`. Bridge commands (`write_state_file`, `read_and_clear_commands`, `write_meta_agent_prompt`, `cleanup_bridge_files`) removed in Phase 6.
- [x] **Ephemeral bridge files** — Bridge files (state.json, commands.jsonl, haiku-context.json) auto-cleaned on app exit via `cleanup_bridge_files` Rust command. `metaAgentMessages` store array bounded to 100 entries.
- [x] **Terminal tab bar** — When terminal overlay is visible, shows all sessions as compact tabs at the top. Each tab has a state dot, project name, and optional context warning badge (≥80%). Back button returns to canvas. Tab styles match session node states.
- [x] **Cowork dark theme** — Updated all color tokens to match Claude Cowork design system (warm grays, clay accent #d4744a, blue secondary #6ea8e0, purple tertiary #bc8cff).
- [x] **Bug fix: Shannon conversation history** — Was one message behind due to stale closure in useCallback when building conversation context. Fixed by including pending state in the messages array directly.
- [x] **Bug fix: 500ms metadata churn** — Added JSON fingerprint change detection in `useClaudeState` to only update Zustand when metadata meaningfully changes, eliminating re-render churn from polling.
- [x] **Bug fix: Forward-reference in TerminalPanel** — Resolved circular dependency between hooks via `terminalRef` ref-based pattern.
- [x] **Bug fix: --bg-hover CSS variable missing** — Added `--bg-hover` to theme system and `index.html` `:root` defaults.
- [x] **Bug fix: Hardcoded hex in CSS** — Added `--accent-tertiary` variable for purple/magenta, replaced all hardcoded magenta hex values.
- [x] **Bug fix: metaAgentMessages bounded injection** — Added `metaAgentMessageSeq` monotonic counter to prevent unbounded array growth during Haiku message injection.
- [x] **Bug fix: Shannon local messages unbounded** — Added `MAX_LOCAL_MESSAGES=200` cap to prevent memory growth.
- [x] **Bug fix: Duplicate subagent display** — Removed stats row chip for subagent count, kept animated indicator only.
- [x] **Code quality: Dead try/catch** — Removed dead try/catch in Shannon system prompt builder.
- [x] **Code quality: Misleading comment** — Fixed misleading control bridge timing comment.
- [x] **Documentation validation script** — `scripts/doc-check.sh` validates TypeScript, tests, file inventory, CSS conventions, theme system, documentation files, and Rust compilation. Compatible with Git Bash on Windows.
- [x] **PTY writer registry** — `src/lib/ptyRegistry.ts` provides a global registry for PTY write functions, enabling the control bridge to send input to specific sessions.
- [x] **Control bridge: send-input command** — New `send-input` command types text into a session's terminal PTY. Enables meta-agent to send prompts to Claude sessions.
- [x] **Control bridge: rename-session command** — New `rename-session` command changes a session's display name.
- [x] **Enriched Shannon system prompt** — Session listing now includes current action, summary, subagent count, and task progress. Active tab ID shown. Short session ID prefixes for easy reference.
- [x] **Richer state.json** — Added `contextWarning` and `createdAt` fields to state snapshot.
- [x] **Code-split bundle** — Vite `manualChunks` splits xterm.js (@xterm/* packages) and canvas (@xyflow/react + dagre) into separate chunks. Initial bundle reduced from ~903KB to 232KB.
- [x] **PTY registry tests** — Unit tests for `ptyRegistry.ts` (register, unregister, replace, missing). Reduced to 3 tests in Phase 7 after `writeToPty` removal.
- [x] **Directory picker dialog** — Added `tauri-plugin-dialog` (Rust + npm). Browse button next to path input in session launcher opens native OS folder picker. Dialog permission added to capabilities.
- [x] **Smart session naming** — Haiku summariser now generates 2-4 word names for sessions still using default directory-basename names. Names included alongside summaries in JSON response. Only applies if session hasn't been manually renamed.
- [x] **Desktop notifications** — Added `tauri-plugin-notification` (Rust + npm). Fires native OS notifications when background sessions complete responses, need permission, or error. 30s cooldown per session. Enabled by default via `notificationsEnabled` setting.
- [x] **Transcript export** — "Copy Transcript" command in palette (Ctrl+K). Reads xterm.js buffer via `getBufferText()` and copies to clipboard. Terminal buffer registry (`terminalRegistry.ts`) maps session IDs to extraction functions.
- [x] **Fix nested session detection** — Claude Code sets `CLAUDECODE` env var to prevent nesting. `lib.rs` strips it at startup so spawned PTY sessions don't inherit it.
- [x] **Fix terminal vs meta-agent focus stealing** — Shannon textarea set to `tabIndex={-1}` (click-only, no keyboard tab cycling). Terminal reclaims focus via `focusout` handler when visible. Prevents keystroke alternation between terminal and Shannon input.
- [x] **Rich terminal tab bar** — Terminal-mode tab bar redesigned from compact chips to full session cards showing state dot, name, model badge, summary, and stats (duration, context, cost). Horizontal scroll with visible scrollbar for overflow. Cards match SessionNode visual style.

### Phase 3.5+: Shannon Markdown + Canvas Live Preview
- [x] **Shannon markdown rendering** — Assistant messages in MetaAgentPanel now render via `react-markdown`. Supports bold, code, lists, headings, links. User/system messages remain plain text. Scoped CSS styles for markdown elements.
- [x] **Canvas live output preview** — Each session node shows the last 4 lines of real-time PTY output, updating every 500ms via existing polling. Monospace, 9px, subtle background. Hidden for dead sessions.
- [x] **Enhanced subagent visualization** — Session nodes show recent Agent-related output lines (up to 3) below the animated subagent dots. Extracted via `getSubagentLines()` pattern matching on buffer.
- [x] **Larger canvas nodes** — Regular nodes increased from 80→140px height, child nodes from 60→80px, to accommodate live preview content.
- [x] **New metadata fields** — `recentOutput` (string) and `subagentActivity` (string[]) added to SessionMetadata in both TypeScript and Rust. Rust fields use `#[serde(default)]` for backwards-compatible deserialization.
- [x] **Dead infrastructure removal** — Removed `parentSessionId`, `MetaAgentTier`/`metaAgentTier`, `getMetaAgent()`, `getMetaAgents()`, `getHaikuAgent()`, `getChildSessions()`, child node layout/sizing/CSS, meta-agent node sizing in dagre (filtered before layout anyway), and 3 dead graphLayout tests. Kept `isMetaAgent` (actively used by 10+ filter sites).

### Phase 4: JSONL-Based State Detection
- [x] **Replace PTY regex scanning with JSONL structured data** — Complete architectural overhaul of state detection. PTY output is now display-only. All session metadata (state, cost, tools, subagents) derived from Claude Code's JSONL conversation files via a Rust file watcher + Tauri events + frontend processor.
- [x] **Rust JSONL watcher** (`src-tauri/src/jsonl_watcher.rs`) — Background thread polls `~/.claude/projects/{encoded-dir}/{session-id}.jsonl`, emits new lines as `jsonl-event` Tauri events. Managed state with start/stop commands.
- [x] **Deterministic JSONL path** — `--session-id <uuid>` CLI flag auto-set in `create_session`. Added `sessionId` to `SessionConfig` (Rust + TS).
- [x] **JSONL state processor** (`src/lib/jsonlState.ts`) — Pure function `processJsonlEvent()` derives `SessionState` + metadata from typed JSONL events (assistant, user, progress, result, system). State machine: `stop_reason: "end_turn"` → idle, `stop_reason: "tool_use"` → toolUse, `tool_result` → thinking.
- [x] **Token-based cost calculation** — Cost derived from accumulated input/output tokens using model-specific pricing (Opus $15/$75, Sonnet $3/$15, Haiku $0.80/$4). No more regex cost parsing.
- [x] **Rewritten useClaudeState** — Replaced polling interval + stateDetector with Tauri `listen("jsonl-event")`. Minimal PTY scan retained only for permission detection (4 regex patterns on rolling 300-char buffer).
- [x] **Deleted stateDetector.ts** — Removed 314-line heuristic parser and 47 tests. Replaced with 26 JSONL state tests.
- [x] **New metadata fields** — `currentToolName`, `inputTokens`, `outputTokens` added to SessionMetadata (Rust + TS).
- [x] **StateBanner reads metadata** — Uses `session.metadata.currentToolName` instead of calling deleted `detectCurrentTool()`.
- [x] **suppressTimestamp removed** — No longer needed since state detection doesn't use data freshness.

### Phase 5: Post-Testing UX Improvements
- [x] **Token count display** — Replaced `$X.XX` cost display with compact token counts (`36K tokens`) on session nodes, terminal tab bar, and status bar. Added `formatTokenCount()` helper to `claude.ts`. Only counts `input_tokens` + `output_tokens` (excludes cache tokens to avoid inflation). Keeps cost calculation internally.
- [x] **Permission detection fix** — Increased PTY rolling buffer from 300→800 chars. Strips ANSI escape sequences before buffering. 8 permission patterns (module-level constant). Added JSONL timeout heuristic: if `toolUse` state with no JSONL events for 10+ seconds, re-checks PTY buffer.
- [x] **Copy Session ID context menu** — Right-click on session nodes shows context menu with "Copy Session ID" and "Copy JSONL Path". Rendered via `createPortal` to `document.body` (avoids React Flow CSS transform issues). Dismissed on click-outside or Escape. Added "Copy Session ID" to command palette (Ctrl+K).
- [x] **Fix Haiku premature naming** — Added `assistantMessageCount` to `JsonlAccumulator` and `SessionMetadata` (TS + Rust). Haiku summariser now gates naming on `assistantMessageCount >= 2`, preventing "Obsidian Vault" naming before any conversation. New session trigger also gated on `>= 2` messages.
- [x] **Improved Haiku prompt** — Session data now includes `LastOutput` and `Summary` fields so Haiku summarises actual conversation content, not project directory context.
- [x] **Message-count re-summarization** — Re-triggers Haiku summarisation every 10 assistant messages per session, ensuring drifted conversations get updated names/summaries. Tracked via `lastSummarisedAt` map inside the store subscription. Complements the existing state-transition trigger.
- [x] **Session name on canvas** — `SessionNode` now shows `session.name` when it differs from the default `dirToTabName()`, reflecting Haiku-generated names on the canvas.
- [x] **Subagent JSONL watcher (Rust)** — `start_subagent_watcher` / `stop_subagent_watcher` commands in `jsonl_watcher.rs`. Scans `~/.claude/projects/{enc}/{session-id}/subagents/` for `agent-{hex}.jsonl` files, polls every 2s, emits `jsonl-subagent-event` Tauri events.
- [x] **Subagent types** — Added `Subagent` interface to `session.ts` (id, parentSessionId, state, description, tokenCount, currentAction).
- [x] **Subagent store** — Added `subagents: Map<string, Subagent[]>` to session store with `addSubagent`, `updateSubagent` actions.
- [x] **Subagent state hook** — `useSubagentWatcher.ts` listens for `jsonl-subagent-event` Tauri events, maintains per-subagent `JsonlAccumulator`, updates store with state/tokens/description.
- [x] **SubagentNode component** — Multiline 240×90 canvas node showing state dot, description (2-line clamp), current action (2-line clamp), and token count. Connected to parent via animated dagre edges. Clicking opens parent session's terminal.
- [x] **Graph layout with subagents** — `computeLayout()` now accepts optional `subagentMap`, creates subagent nodes below parent with TB edges. Edges animated when subagent is thinking/toolUse. Completed subagents (idle/dead) filtered from canvas.
- [x] **Multiline speech bubbles** — Session node speech bubbles now show last 3 lines of output with 4-line clamp (300px max width), not single-line truncation.
- [x] **Canvas re-fit on panel toggle** — Canvas auto-fits nodes when meta-agent panel opens/closes, preventing off-center layout.
- [x] **dangerouslySkipPermissions toggle** — Session launcher has "Skip All" danger button for `--dangerously-skip-permissions`. Setting remembered across launches via `lastConfig`.
- [x] **Removed SubagentViewer + sub-tabs** — SubagentViewer and terminal sub-tabs removed (fundamentally broken: no historical data available when mounting). Subagent state visible via canvas nodes only. Orphaned files deleted.
- [x] **Store cleanup** — Removed `getSubagents` method (anti-pattern: `|| []` created new array references every render cycle causing render storms). Direct `Map.get()` with stable empty array constant used instead.
- [x] **New tests** — 7 new tests: `formatTokenCount` (5 tests in claude.test.ts), `assistantMessageCount` (2 tests in jsonlState.test.ts). Total: 62 tests.

### Phase 5.5: UX Iteration
- [x] **Active-only duration timer** — Timer now only counts time when session state is active (thinking, toolUse, waitingPermission, error). Pauses during idle/starting states. Shows actual work time, not wall-clock time.
- [x] **Restyled speech bubbles** — Removed background/border/caret from canvas speech bubbles. Now uses text shadow on `var(--bg-primary)` for readability. Width increased to 260px (wider than 220px nodes). Ephemeral, floating text style.
- [x] **Fix orphaned subagents on cancel** — When parent PTY exits (Ctrl+C), cascades dead state to all child subagents via `updateSubagent`. Subagents now correctly filter from canvas after parent cancellation.
- [x] **Vertical subagent stacking** — Subagent nodes removed from dagre graph; manually positioned in a vertical column below parent (centered on parent's X). Prevents parent drift caused by wide fan-out trees. Edges chain vertically: parent→sub1→sub2→sub3.
- [x] **Subagent conversation inspection** — Added `SubagentMessage` type with text/tool data. `useSubagentWatcher` now accumulates conversation messages (assistant text, tool_use blocks, tool_result snippets) as events arrive, stored in Zustand. New `SubagentInspector` overlay renders conversation on subagent node click. Escape dismisses. Solves the "no historical data" problem from the old SubagentViewer.
- [x] **Fix meta-agent panel first message width** — Changed `.shannon-msg-system` from `align-self: center` to `align-self: stretch; text-align: center` so first system message renders full width like subsequent ones.
- [x] **Permission pattern cleanup** — Extracted duplicate `PERMISSION_PATTERNS` arrays in `useClaudeState.ts` to a single module-level constant.
- [x] **New tests** — 3 new tests for subagent vertical stacking and filtering in graphLayout.test.ts. Total: 65 tests.

### Phase 5.5b: State Detection & Subagent Fixes
- [x] **Fix state stuck on "Bash: running"** — Progress events were unconditionally setting state to `toolUse`, even after tool completion. Now only update `currentAction` if already in `toolUse`/`starting` state. Result events now clear `currentAction` and `currentToolName`.
- [x] **Fix subagent poll interval** — Reduced Rust subagent directory scanner from 2s to 500ms (matching main JSONL watcher), preventing missed fast subagents.
- [x] **Fix stuck "initializing" subagents** — Added 30s staleness timeout in `useSubagentWatcher`. Subagents stuck in starting/thinking/toolUse with no events for 30s are auto-marked dead and filtered from canvas.
- [x] **Tighter subagent spacing** — Reduced PARENT_SUBAGENT_GAP from 40→20px and SUBAGENT_GAP from 16→8px for tighter vertical stacking.
- [x] **Canvas performance optimization** — SessionNode now subscribes directly to Zustand store (by sessionId) instead of receiving the full session object via layout props. Layout only recomputes on session add/remove, not on every metadata tick. Uses stable `sessionIds` string key for memoization.
- [x] **New tests** — 3 tests for stale progress events and result event cleanup in jsonlState.test.ts. Total: 68 tests.

### Phase 5.5c: UI Polish & Meta-Agent Overhaul
- [x] **Speech bubble centering** — Bubble width reduced from 260px to 220px (matches node width) so `left: 50%` + `translateX(-50%)` centers perfectly.
- [x] **SessionNode summary-first layout** — Removed bottom row (model badge with border) and stats chips row. Summary is now dominant middle element (3-line clamp, 12px, primary color). Compact corner line at bottom-right shows model + duration + tokens in 9px muted text.
- [x] **Meta-agent IRC-style overhaul** — Complete restyle of Shannon panel messages. System messages render as full-width dividers (thin line with centered text). User messages have `>` prefix, no background. Assistant messages are borderless with markdown. Removed all timestamps, reduced message gap to 4px, removed bubble border-radius and max-width constraints.
- [x] **Subagent node tighter spacing + smaller size** — PARENT_SUBAGENT_GAP 20→12, SUBAGENT_GAP 8→4, node size 240×90→200×60. Description and action are single-line clamp. Width matches parent node (200px).
- [x] **Subagent batch retention** — Changed filter logic: keep ALL subagents visible while ANY sibling is still active. Idle siblings stay visible until whole batch finishes. Dead subagents still filter immediately.
- [x] **Subagent chip row in terminal view** — Below terminal tab bar, shows compact chips for active session's non-dead subagents. Each chip has state dot + truncated description. Click opens SubagentInspector.
- [x] **Speech bubble markdown** — Bubble content wrapped in ReactMarkdown. Scoped CSS keeps 10px font, no paragraph margins.
- [x] **Fix cmd.exe window flash** — Added `CREATE_NO_WINDOW` flag (0x08000000) to Shannon's `tokio::process::Command` on Windows, preventing console window flash.
- [x] **Shannon auto-permissions** — Added `--dangerously-skip-permissions` to Shannon CLI args so it can write to control bridge files without prompting.
- [x] **Launcher global Enter key** — Replaced div-level `onKeyDown` with `useEffect` global `window.addEventListener("keydown")`. Enter/Escape work regardless of focus.
- [x] **New tests** — 1 new test for batch retention in graphLayout.test.ts. Total: 69 tests.

### Phase 5.5d: Persistent Meta-Agent Sessions
- [x] **Persistent PTY sessions for meta-agents** — Shannon and Haiku summariser now spawn Claude CLI in interactive mode (not pipe mode) and keep the process alive across messages. Messages are sent by writing to the PTY, responses captured by buffering output and detecting when Claude returns to the input prompt. Eliminates process spawn overhead per message.
- [x] **metaAgentSession.ts** — New module manages persistent PTY sessions. Handles ANSI stripping, response boundary detection (prompt pattern + idle timeout), auto-restart on crash. Messages must be single-line (Claude CLI treats newlines as Enter/submit).
- [x] **Shannon system prompt split** — Static system prompt (identity, capabilities, guidelines) set once at session startup via `--system-prompt`. Dynamic context (current sessions, active tab, CLI version) prepended to each message as compact single-line bracket format.
- [x] **Shannon conversation continuity** — Persistent session maintains conversation natively in Claude's context. No longer rebuilds full conversation history per message.
- [x] **Haiku compact prompts** — Session data formatted as compact JSON array on single line for PTY compatibility. System prompt set at startup; per-trigger data sent as user message.
- [x] **Meta-agent lifecycle** — Sessions start on first use (lazy), auto-restart if crashed (isReady check before each message), cleanup on app exit via stopAll().
- [x] **Shannon command extraction** — JSON commands embedded in Shannon's responses extracted and executed directly by the frontend (send-input, create-session, close-session, set-active, rename-session).

### Phase 5.5e: Bug Fixes — Dead Session Crash & Shannon Hang
- [x] **Fix grey screen crash on dead session close** — TerminalPanels were mounted for dead sessions (from persistence restore), creating xterm.js + WebGL instances on hidden containers. Closing triggered dispose crashes with no error boundary. Fixed by filtering dead sessions from TerminalPanel rendering (`regularSessions.filter(s => s.state !== "dead")`).
- [x] **Fix useSubagentWatcher dependency bug** — Dependency `sessionState === "dead"` created a boolean that flipped from `true` to `false` when the session was removed from the store (state becomes `undefined`), causing the effect to re-fire and invoke a Rust command with a stale session ID. Changed to depend on `sessionState` directly.
- [x] **Fix SessionNode close error handling** — Added `.catch()` to `closeSession()` call in the close button handler to prevent unhandled promise rejections from crashing React rendering.
- [x] **Fix Shannon persistent session hanging** — Response boundary detection only checked the absolute last line of the buffer. When Claude outputs `"response\n>\n"`, `split("\n").pop()` returns `""` (empty trailing line), missing the prompt. Fixed by checking the last 3 non-empty lines. Also handles `\r\n` line endings. Added 120s absolute timeout to prevent infinite hangs.

### Phase 6: Shannon Removal + Haiku One-Shot Revert
- [x] **Remove Shannon meta-agent panel** — Deleted `MetaAgentPanel.tsx`, `MetaAgentPanel.css`, and the `MetaAgent/` component directory. Removed all references from `App.tsx`.
- [x] **Remove persistent PTY sessions** — Deleted `metaAgentSession.ts`. Haiku summariser reverted from persistent interactive PTY to one-shot pipe mode via `invoke("invoke_claude_pipe")`.
- [x] **Remove control bridge** — Deleted `controlBridge.ts` (file-based IPC: state.json, commands.jsonl). Removed `startControlBridge`/`stopControlBridge` from app lifecycle.
- [x] **Rename Rust command** — `send_shannon_message` → `invoke_claude_pipe` (generic one-shot pipe command).
- [x] **Delete Rust bridge commands** — Removed `write_state_file`, `read_and_clear_commands`, `write_meta_agent_prompt`, `cleanup_bridge_files`.
- [x] **Clean session store** — Removed `metaAgentMessages`, `metaAgentMessageSeq`, `metaAgentPanelOpen`, `addMetaAgentMessage`, `setMetaAgentPanelOpen`.
- [x] **Clean settings store** — Removed `metaAgentEnabled`, `metaAgentModel`, `setMetaAgentEnabled`, `setMetaAgentModel`.
- [x] **Clean types** — Removed `MetaAgentMessage` interface.
- [x] **Clean UI config** — Removed `panel` section from `UiConfig` interface and defaults.
- [x] **Clean components** — Removed `panelOpen` from Canvas fitView deps, isMetaAgent star badge from SessionNode, "Launch Interactive Agent" from CommandPalette.
- [x] **App layout simplified** — Canvas fills full width (no right panel). Two-column layout reduced to single-column.
- [x] **Haiku always runs** — Removed `metaAgentEnabled` gate. Summariser triggers unconditionally when sessions exist.

### Phase 6.1: Dead Session Persistence Fix
- [x] **Fix React Error #300 crash on dead session click** — SessionNode.tsx had 12 hooks (useState, useCallback, useEffect, useRef) called AFTER a conditional early return (`if (!session) return ...`). When `closeSession` removed a session during the revive flow, the component re-rendered with `session = undefined`, returned early, and React detected fewer hooks than the previous render (violation of Rules of Hooks). Fixed by moving ALL hooks before the conditional return.
- [x] **Fix dead sessions invisible on canvas after restart** — React Flow initialized with empty nodes (since `init()` is async), then failed to render nodes added later. Fixed by adding `initialized` flag to session store and delaying Canvas mount until `init()` completes. React Flow now always initializes with the correct set of nodes.
- [x] **Remove defensive programming garbage** — Removed `AppErrorBoundary` class component from App.tsx (was masking the real crash). Removed multi-phase fitView (3 setTimeout calls at 0/100/500ms) from Canvas.tsx. Restored `fitView` and `fitViewOptions` props on ReactFlow. Removed unused `rfReady` state and `useState` import from Canvas.
- [x] **Dead session test suite** — 13 new tests in `deadSession.test.ts`: canvas filter for dead sessions (4 tests), dead session layout/positioning (3 tests), revive flow config/naming (4 tests), TerminalPanel filter (2 tests).

### Phase 7: v1 Prep
- [x] **Fix `--session-id` + `--resume` CLI conflict** — Claude CLI rejects `--session-id` when combined with `--resume` unless `--fork-session` is specified. `build_claude_args` now skips `--session-id` for resumed/continued sessions. Fixes both dead session revival and SessionLauncher resume flow.
- [x] **Fix JSONL watcher for resumed sessions** — When resuming a session, Claude writes to the original session's JSONL file. The watcher now accepts an optional `jsonlSessionId` parameter to watch the correct file while tagging events with the app's internal session ID. Same fix applied to the subagent watcher.
- [x] **Fix dead sessions invisible on canvas startup** — Added explicit `fitView` call in React Flow's `onInit` callback via `requestAnimationFrame` to ensure nodes are visible after container measurement. The `fitView` prop can race with container measurement on first render.
- [x] **Remove `writeToPty` from ptyRegistry.ts** — Only used by the deleted control bridge. Updated docstring, simplified tests.
- [x] **Remove `get_app_dir` Rust command** — Only used by deleted meta-agent. Removed from commands.rs and lib.rs handler.
- [x] **Remove `get_data_dir_path` Rust command** — Not referenced by any frontend code. Removed from lib.rs handler.
- [x] **Remove `get_tab_order` and `session_count` from SessionManager** — Dead code, eliminated the Rust dead_code warning.
- [x] **Remove uiConfig polling system** — The 3-second poll loop was for Shannon (meta-agent) to modify UI config. Without Shannon, config is loaded once at startup. Removed `pollConfig`, `startConfigWatcher`, `stopConfigWatcher`.
- [x] **Remove stale Shannon comments** from TerminalPanel focus-reclaim logic.

### Phase 8: Terminal-First Redesign
- [x] **Remove React Flow canvas** — Deleted `Canvas.tsx`, `Canvas.css`, `SessionNode.tsx`, `SessionNode.css`, `SubagentNode.tsx`, `SubagentNode.css`. Removed `@xyflow/react`, `dagre`, `@types/dagre`, `react-markdown` from package.json.
- [x] **Remove graph layout** — Deleted `graphLayout.ts` and `graphLayout.test.ts` (11 tests removed).
- [x] **Terminal-first layout** — App opens directly to terminal view. No canvas, no terminal overlay, no back button. Terminal IS the view.
- [x] **Dense tab bar** — Single-row compact tabs with state dot, session name, model badge, and inline close button. `+` button at right end. Dead tabs shown faded, clickable to revive.
- [x] **Subagent bar** — Substantial row below tab bar replacing the tiny chip row. Full-width cards with animated left border for active subagents. Shows description + token count.
- [x] **ActivityFeed component** — `src/components/ActivityFeed/ActivityFeed.tsx` and `ActivityFeed.css`. IRC-style right pane (~20% width) showing timestamped activity from all sessions: state changes, Haiku summaries, name changes, session lifecycle events. Auto-scrolls, max 200 entries.
- [x] **Remove canvas-related state** — Removed `terminalVisible`, `dismissTerminal`, `handleNodeActivate`, canvas/node sections from `UiConfig`, `deadSessions.showOnCanvas`, `deadSessions.opacity`.
- [x] **Simplified keyboard shortcuts** — No terminalVisible toggling needed. Escape only dismisses modals/inspector.
- [x] **Empty state** — Terminal-black background with "Press Ctrl+T" hint when no sessions exist.
- [x] **Reduced bundle** — From 3 chunks (index 356KB + canvas 284KB + xterm 397KB) to 2 chunks (index 244KB + xterm 397KB). Canvas chunk eliminated entirely.
- [x] **Rewritten dead session tests** — Removed canvas-specific tests, added revive conversation check tests. deadSession.test.ts now has 10 tests (was 13).

## Pending Work

### Nice-to-have (can defer)
- [ ] Tab grouping (auto by git root)
- [ ] Tool call highlighting in terminal (color-coded left borders via terminal decorations)
- [ ] Session orchestration (pipeline workflows)
- [ ] Cross-session awareness and suggestions
- [ ] Context percentage from JSONL (not currently emitted by Claude Code — may need future CLI support)
- [ ] Plugin system (event bus, view slots, manifest)
- [ ] Video game visualization plugin
- [ ] Agent orchestration workflows
- [ ] Light mode theme

## Known Issues

1. **Context % not available via JSONL**: Claude Code's JSONL doesn't emit context window usage percentage. This stat will show 0 until CLI adds it or a fallback is implemented.

## File Inventory

| File | Purpose | Last Changed |
|------|---------|--------------|
| `src-tauri/src/lib.rs` | Plugin registration, app builder, JSONL watcher state | Phase 7 |
| `src-tauri/src/commands.rs` | All IPC command handlers (invoke_claude_pipe, CREATE_NO_WINDOW) | Phase 7 |
| `src-tauri/src/jsonl_watcher.rs` | JSONL file tailer + subagent directory watcher, emits Tauri events (+jsonlSessionId for resumed sessions) | Phase 7 |
| `src-tauri/src/session/mod.rs` | SessionManager (in-memory state) | Phase 1 |
| `src-tauri/src/session/types.rs` | Session, SessionConfig, SessionMetadata (+assistantMessageCount) | Phase 5 |
| `src-tauri/src/session/persistence.rs` | Save/load sessions JSON | Phase 1 |
| `src/App.tsx` | Root component, keyboard shortcuts, tab bar + subagent bar + terminal + activity feed | Phase 8 |
| `src/App.css` | App styles, terminal-first layout, tab bar, subagent bar CSS | Phase 8 |
| `src/main.tsx` | Entry point, theme initialization | Phase 2.5 |
| `src/lib/theme.ts` | Theme definitions (Cowork tokens), CSS variable setter, xterm theme | Phase 3.5 |
| `src/lib/claude.ts` | CLI detection, arg builder, helpers (+formatTokenCount) | Phase 5 |
| `src/lib/jsonlState.ts` | JSONL event processor — state machine + cost + metadata (+assistantMessageCount) | Phase 5 |
| `src/lib/__tests__/jsonlState.test.ts` | 28 tests for JSONL state processing (+assistantMessageCount) | Phase 5 |
| `src/lib/__tests__/theme.test.ts` | 4 tests for theme structure | Phase 2.5 |
| `src/lib/__tests__/claude.test.ts` | 14 tests for CLI helpers (+formatTokenCount) | Phase 5 |
| `src/lib/__tests__/metaAgent.test.ts` | 5 tests for sessionFingerprint utility | Phase 3.5 |
| `src/lib/metaAgentUtils.ts` | Pure utility functions for meta-agent (sessionFingerprint) | Phase 3.5 |
| `src/lib/ptyRegistry.ts` | Global PTY reader registry for session PTY access | Phase 7 |
| `src/lib/terminalRegistry.ts` | Terminal buffer reader registry for transcript export | Phase 3.5 |
| `src/lib/__tests__/ptyRegistry.test.ts` | 3 tests for PTY registry | Phase 7 |
| `src/lib/__tests__/deadSession.test.ts` | 10 tests for dead session visibility, revive flow, revive conversation checks | Phase 8 |
| `src/types/session.ts` | TypeScript types (+Subagent, +SubagentMessage, +assistantMessageCount) | Phase 6 |
| `src/types/ipc.ts` | IPC command type contracts | Phase 1 |
| `src/store/sessions.ts` | Zustand session store (+subagents Map, +initialized flag) | Phase 6.1 |
| `src/store/settings.ts` | Zustand settings store (cliVersion, previousCliVersion, cliCapabilities) | Phase 6 |
| `src/hooks/usePty.ts` | PTY spawn + data type coercion (number[] to Uint8Array) | Phase 2.5 |
| `src/hooks/useTerminal.ts` | xterm.js instance lifecycle (+ theme integration) | Phase 2.5 |
| `src/hooks/useClaudeState.ts` | JSONL event listener + PTY permission scan (800-char buffer, ANSI strip, 8 patterns, 10s timeout heuristic) | Phase 5 |
| `src/hooks/useMetaAgent.ts` | Haiku meta-agent hook — one-shot pipe mode, compact prompts, gated naming | Phase 6 |
| `src/hooks/useSubagentWatcher.ts` | Listens for subagent JSONL events, accumulates conversation messages, updates store | Phase 5.5 |
| `src/hooks/useCliWatcher.ts` | CLI version detection + capability parsing | Phase 3.5 |
| `src/hooks/useNotifications.ts` | Desktop notifications for background session events | Phase 3.5 |
| `src/lib/uiConfig.ts` | Shared UI config store (ui-config.json, loaded once at startup, no canvas/node sections) | Phase 8 |
| `scripts/doc-check.sh` | Documentation validation script (build, inventory, CSS, theme) | Phase 3.5 |
| `src/components/ActivityFeed/ActivityFeed.tsx` | IRC-style right pane showing timestamped activity from all sessions | Phase 8 |
| `src/components/ActivityFeed/ActivityFeed.css` | Activity feed styles (~20% width right pane) | Phase 8 |
| `src/components/SubagentInspector/SubagentInspector.tsx` | **NEW** Read-only conversation viewer overlay for subagent JSONL data | Phase 5.5 |
| `src/components/SubagentInspector/SubagentInspector.css` | **NEW** Inspector overlay styles | Phase 5.5 |
| `src/components/Terminal/TerminalPanel.tsx` | xterm.js + PTY + JSONL watcher + subagent watcher + active-only timer + cascade cleanup | Phase 5.5 |
| `src/components/Terminal/TerminalPanel.css` | Terminal styles + banner overlay | Phase 5 |
| `src/components/SessionLauncher/SessionLauncher.tsx` | Launcher modal (global Enter key, resume, directory picker, dangerouslySkipPermissions) | Phase 5.5c |
| `src/components/SessionLauncher/SessionLauncher.css` | Launcher styles (+ resume cards, browse button, danger button) | Phase 5 |
| `src/components/StatusBar/StatusBar.tsx` | Icon-first status bar (token count display, dangerouslySkipPermissions indicator) | Phase 5 |
| `src/components/StatusBar/StatusBar.css` | Status bar styles (CSS vars, pulsing dot, Cowork tokens) | Phase 3.5 |
| `src/components/CommandPalette/CommandPalette.tsx` | Ctrl+K command palette (+Copy Session ID) | Phase 6 |
| `src/components/CommandPalette/CommandPalette.css` | Palette styles (CSS vars) | Phase 2.5 |
| `index.html` | HTML entry point (Cowork :root defaults, --bg-hover, --accent-tertiary) | Phase 3.5 |
| `TESTING.md` | Manual test protocol + automated test instructions | Phase 3.5 |
