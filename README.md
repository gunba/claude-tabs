# Code Tabs

A desktop app for running Claude Code and OpenAI Codex CLI sessions side by side in tabs. Code Tabs has a Rust backend, a React/TypeScript frontend, and no app-level API key requirement: it uses the CLIs you already have installed and authenticated.

![Screenshot](ss.png)

## Features

- **Multiple coding-agent sessions in tabs** - Run Claude Code and Codex sessions side by side with fixed-width tabs, drag-to-reorder, working-directory grouping, and auto-respawn of dead tabs.
- **First-party Claude Code and Codex support** - Launch either CLI when installed, hide features for missing CLIs, and keep slash commands, models, settings, hooks, MCP, and skills scoped to the active ecosystem.
- **Auto-discovery for installed CLIs** - Detect versions, command options, models, slash commands, env hints, settings, skills, and plugins where each CLI exposes them.
- **Visual CLI launcher** - Pick Claude Code or Codex, set per-CLI model/effort/permission options, preview the full command, and quick-launch with saved workspace defaults.
- **Session resume with content search** - Browse past Claude Code conversations and Codex rollouts with previews, model badges, working directory context, and searchable transcript content.
- **Configuration manager (Ctrl+,)** - Edit settings, env vars, instructions, hooks, plugins, MCP, agents, prompts, skills, port content, and observability across User / Project / Project Local scopes where supported.
- **Portable project content** - Copy or translate compatible `.claude/` and `.codex/` project content, including skills, AGENTS/CLAUDE instructions, and MCP server config, with a mandatory backup before writes.
- **Subagents as first-class terminals** - Track nested agents with elapsed time, tokens, and cost; open the inspector for conversation, edits, shell commands, and file tool calls.
- **Live tok/s, latency, and cost** - EMA-smoothed output throughput, API latency, network RTT, and per-session spend derived from structured events instead of terminal scraping.
- **Command bar with usage heat** - Rank slash commands by how rarely you use them, click to type, Ctrl+click to send, and keep a per-session history strip.
- **Activity panel** - Show the files touched by the latest response, with main-agent and subagent markers at their last edit sites.
- **Cross-session terminal search (Ctrl+Shift+F)** - Regex search across every live terminal buffer with a 500-result cap.
- **System prompt / context viewer** - Inspect captured system and instruction blocks with token stats and cache-boundary markers.
- **Observability event pipeline** - Classify Claude Code TAP entries and Codex rollout events into typed frontend state so the UI follows agent activity deterministically.
- **API proxy and prompt rewrite tools** - Route supported provider requests, apply prompt rewrite rules, log traffic when enabled, and track per-rule match counts.
- **Desktop notifications with click-to-focus** - Rate-limited notifications on response complete, permission needed, or error; clicking jumps to the source tab.
- **WebGL terminal** - 1M fixed scrollback, DEC 2026 synchronized output, batch-debounced writes, OSC 52 clipboard-hijack stripping, and scroll-to-last-message via prompt-marker detection.

## Install

Download the latest build from [Releases](../../releases):

- Windows: NSIS installer `.exe` or `code-tabs-windows-portable.exe`
- Linux: `.deb`, `.rpm`, `.AppImage`, or `code-tabs-linux-portable`

Or build from source:

```bash
npm install
npm run build:release
```

Build outputs are written under `src-tauri/target/release/`:

- Windows installer: `bundle/nsis/`
- Linux packages: `bundle/deb/`, `bundle/rpm/`, and `bundle/appimage/`
- Portable binary: `code-tabs` or `code-tabs.exe`

### Requirements

- Windows 10 (21H2+), Windows 11, or Linux with the WebKitGTK dependencies required by Tauri v2
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/overview) and/or [OpenAI Codex CLI](https://developers.openai.com/codex/cli) installed and authenticated
- WebView2 runtime (pre-installed on Windows 11)
- Node.js 20 and a stable Rust toolchain for source builds

## Development

```bash
npm run tauri dev        # Dev mode with hot-reload
npx tsc --noEmit         # Type-check
npm test                 # Unit tests (Vitest)
npm run build:quick      # Quick build (no NSIS installer)
npm run build:debug      # Debug build (no NSIS installer)
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Shift+N | New session |
| Ctrl+W | Close active tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Cycle tabs (skips dead) |
| Alt+1-9 | Jump to tab N |
| Ctrl+K | Command palette |
| Ctrl+, | Configuration manager |
| Ctrl+Shift+R | Resume past session |
| Ctrl+Shift+F | Cross-session terminal search |
| Ctrl+Home / Ctrl+End | Scroll to top / bottom |
| Ctrl+Wheel | Snap to top / bottom |
| Ctrl+Middle-click | Scroll to last message |
| Shift+Click tab | Relaunch with new options |
| Right-click tab | Context menu (copy ID, rename, etc.) |
| Escape | Dismiss (ordered: context menu, palette, side panel, config, resume, launcher, inspector) |

Activity, Search, and Debug views are tabs in the right panel. Click to switch, or hit Ctrl+Shift+F to jump straight to Search.

## Local Data

- App data and session logs: `%LOCALAPPDATA%\code-tabs` on Windows, `${XDG_DATA_HOME:-~/.local/share}/code-tabs` on Linux
- Port-content backups: `~/.code_tabs/backups/`

## Architecture

```
React 19 + TypeScript (Tauri webview)
  |
  Tauri v2 IPC
  |
  Rust Backend
  |-- ConPTY / openpty --> Claude Code CLI / Codex CLI
  |-- Observability events <-- TAP / rollout capture
  |-- API proxy --> provider routing and prompt rewrites
  |-- Desktop notifications
```

Built with [Tauri v2](https://tauri.app), [xterm.js 6](https://xtermjs.org), [Zustand](https://github.com/pmndrs/zustand), and [React 19](https://react.dev).

## License

MIT
