# Project Conventions

<!-- Codes: AR=Architecture, BV=Build & Validate, CD=Commands, LO=Layout, DC=Doc Cross-references -->

- [AR-01] Core data flow: React UI (WebView2) communicates with Rust backend via Tauri IPC, which manages PTY sessions to the Claude Code CLI
  ```
  React UI (WebView2) <-> Tauri IPC <-> Rust Backend <-> PTY (ConPTY/openpty) <-> Claude Code CLI
  ```

- [BV-01] Build commands:
  - `npm run build:quick` — Release binary, no installer (~30s after first build)
  - `npm run build:debug` — Debug binary, fastest (~10-15s incremental)
  - `npm run tauri dev` — Dev mode with hot-reload (frontend only, Rust recompiles on change)
  - `npm run tauri build` — Full installer (NSIS on Windows, deb/rpm/appimage on Linux)
  - Binary: `src-tauri/target/release/claude-tabs` (quick) or `src-tauri/target/debug/claude-tabs` (debug)
- [BV-02] Never do a full NSIS build just to test. Use build:quick or build:debug.
- [BV-03] Before every commit: `npx tsc --noEmit` (zero TS errors), `npm test` (all Vitest pass), `cargo check` in src-tauri (zero Rust errors)

- [CD-01] Global slash commands in `~/.claude/commands/`:
  | Command | What it does |
  |---------|-------------|
  | `/r` | Review: document change -> review (1 agent) in worktree |
  | `/j` | Janitor: review local changes -> prove all docs -> sync/audit |
  | `/rj` | Review then janitor — `/r` followed by `/j` |
  | `/b` | Build: [commit?] -> build -> [release+push?] — choose steps upfront |
  | `/c` | Commit, exit worktree, merge to main |

- [LO-01] Main window layout: tab bar, subagent bar, terminal with button bar, command bar (slash commands + skill pills), command history, status bar

- [DC-01] See `.claude/rules/` for path-scoped rules. Each rule file has `paths:` YAML frontmatter for auto-loading by Claude Code.
- [DC-02] All tagged rules are proved via `prove.sh`. Code implementing a tagged entry is not dead code.
