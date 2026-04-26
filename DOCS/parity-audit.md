# Claude ↔ Codex parity audit

Walk every user-visible Claude Code surface and confirm one of:
- ✅ Codex sibling working (cite the file/function that delivers it)
- ⚠️ Codex sibling partial (works but loses something — note what)
- ⛔ No analog (deferred or won't-do — note why)

Audit run: 2026-04-25 (batches 1–10 landed).

## Spawn surface

| Claude | Codex | Status |
|---|---|---|
| `detect_claude_cli_sync` (5-step PATH chain) | `detect_codex_cli_sync` (env override → `which` → fallbacks) | ✅ |
| `build_claude_args(SessionConfig)` | `CodexAdapter::build_spawn` translates `SessionConfig` → Codex flags | ✅ |
| `claude --resume <id>` | `codex resume <id>` subcommand | ✅ |
| `claude --continue` | `codex resume --last` | ✅ |
| `claude --fork-session <id>` | `codex fork <id>` | ✅ |
| `--system-prompt` / `--append-system-prompt` flags | `[instructions]` / `[developer_instructions]` config keys | ⚠️ — Claude has flags; Codex requires editing config.toml. Settings tab does not yet wire those keys. |
| `--mcp-config <path>` | MCP servers come from `~/.codex/config.toml` `[mcp_servers]` only | ⚠️ — no per-session `--mcp-config` equivalent on Codex |
| `--allowedTools` / `--disallowedTools` | Codex has no analog; relies on sandbox + approval policy | ⛔ no analog |
| `--max-budget-usd` | Codex has no analog | ⛔ no analog |
| `BUN_INSPECT` env injection | `codex` is Rust; no inspector | ⛔ N/A — observability via rollout file |

## Discovery

| Claude | Codex | Status |
|---|---|---|
| Models (`ANTHROPIC_MODELS` constant) | `discover_codex_models` runs `codex debug models` (returns full JSON catalog) | ✅ |
| Effort levels (`ANTHROPIC_EFFORTS`) | Per-model `supported_reasoning_levels` from `codex debug models` | ✅ |
| Slash commands (binary scan) | `discover_codex_slash_commands` resolves the installed Codex wrapper/native binary and probes for slash-command strings; falls back to the catalog when the binary is unavailable or under-detected | ⚠️ binary-backed catalog — Codex still has no slash-list CLI endpoint |
| Plugin commands (`~/.claude/plugins/`) | No analog — Codex has skills, not plugins | ⛔ no analog |
| Skills (`SKILL.md` scan) | `discover_codex_skills` — same scanner, Codex roots (`~/.agents/skills/`, `<repo>/.codex/skills/`, `<repo>/.agents/skills/`, `~/.codex/skills/`) | ✅ |
| Settings schema (binary Zod scan) | No analog — Codex config schema not exposed via CLI | ⚠️ Codex settings are first-party in the UI as raw TOML (`~/.codex/config.toml` / `<project>/.codex/config.toml`), without schema guidance |
| Env vars (binary scan + catalog) | `codex --help` parsing surfaces flag-tied env hints | ⚠️ partial |
| CLI option pills (`claude --help`) | `discover_codex_cli_options` parses `codex --help` regex | ✅ |
| Feature flags | `discover_codex_features` runs `codex features list` | ✅ |

## Observability

| Claude | Codex | Status |
|---|---|---|
| Bun inspector + TAP TCP server | Tail `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` via `notify` watcher | ✅ |
| Anthropic SSE stream parsing (`tapClassifier.ts`) | `RolloutItem` JSONL parsing in `observability/codex_rollout.rs` | ✅ |
| `event_msg.token_count` (input/cached/output/reasoning) | Identical fields in `TokenUsageBreakdown`; richer (`reasoning_output_tokens`) | ✅ |
| Tool call start/complete | `response_item.function_call` / `function_call_output` | ✅ |
| Subagent events | Codex has no Task-tool equivalent in the rollout | ⛔ no analog |
| Session compaction | `compacted` rollout item | ✅ |
| `traffic.jsonl` (proxy) | Claude only — Codex doesn't go through the proxy | ⛔ N/A |
| Status bar token totals (per-tab) | Wire from `codex.token_count` events | ✅ rollout watcher emits session-scoped TAP entries; `tapClassifier` + `tapMetadataAccumulator` consume Codex token/tool/message events. |

## UI surfaces

| Claude | Codex | Status |
|---|---|---|
| App name / title | `Code Tabs` in header, window title, Tauri product name, and public page title | ✅ |
| Header CLI versions | Shows Claude and Codex version/status independently | ✅ |
| Per-tab CLI chip in status bar | Chip with color (orange/teal) | ✅ |
| Tab strip CLI indicator | Inline `Claude`/`Codex` badge beside the tab title | ✅ |
| Launcher CLI pill | Shows only installed CLIs; supports Claude-only and Codex-only installs | ✅ |
| Launcher model picker | Driven by `cli_launch_options(active.cli)` | ✅ |
| Launcher effort picker | Driven by adapter's effort_levels (Claude: 5 levels; Codex: 4) | ✅ |
| Launcher CLI option pills | Adapter-driven; Codex pills come from `discover_codex_cli_options` | ✅ |
| Settings tab | Claude JSON settings with schema; Codex raw TOML config | ⚠️ — Codex has no schema/reference panel yet |
| Hooks tab | Claude `settings.json[hooks]`; Codex `[hooks]` in `config.toml` with `features.codex_hooks = true` | ✅ |
| MCP tab | Claude `settings.json[mcpServers]`; Codex `[mcp_servers]` in `config.toml` | ✅ |
| Skills editor | Claude commands/skills; Codex `~/.agents/skills` and `<project>/.agents/skills` | ✅ |
| Plugins tab | Claude only | ⛔ no analog (Codex has no plugins) |
| Prompts tab (system-prompt rewrite rules) | Claude only — applied by the slimmed proxy | ⛔ Codex tabs bypass the proxy; Codex equivalent is `[instructions]`/`[developer_instructions]` config keys (deferred Settings tab wiring). |
| Command palette / slash bar built-ins | Active-terminal scoped: Claude commands for Claude sessions, Codex commands for Codex sessions | ✅ |
| Command palette skills | Active-terminal scoped: Claude plugins/commands/skills and Codex skills are kept in separate stores | ✅ |
| Recording / Observability tab | Reads `observability.jsonl` (CLI-agnostic sink) | ✅ — both CLIs land here |
| Port content tab | Three pairs (Skill, Memory, MCP) with backup tarball | ✅ |
| Worktree tab grouping | `parseWorktreePath()` matches `.claude_tabs/worktrees/<slug>` and legacy `.claude/worktrees/<slug>` | ⚠️ — parser/test coverage migrated; new-worktree default and legacy-location banner still pending. |

## Login / auth

| Claude | Codex | Status |
|---|---|---|
| `claude login` (CLI-managed) | `codex login` (CLI-managed) | ✅ — both delegated to the CLI; no in-app modal for either |

## Port content (`.claude/` ↔ `.codex/`)

| Pair | Status |
|---|---|
| Skill directory copy | ✅ |
| `CLAUDE.md` ↔ `AGENTS.md` (copy or symlink) | ✅ |
| MCP servers (JSON ↔ TOML) | ✅ |
| Hooks translation | ⛔ deferred — translator table needs Codex hook event-name lock-in |
| `.claude/commands/*.md` → Codex skill | ⛔ deferred — best-effort wrapper script worth its own batch |

## Open follow-ups (next batch beyond 10)

1. **Worktree dir rename.** Finish migration from `.claude/worktrees/` → `.claude_tabs/worktrees/`: new-worktree default + per-project legacy-location banner.
2. **Codex settings schema/reference.** Add a typed helper/reference for common `config.toml` keys (`model`, `model_reasoning_effort`, `sandbox_mode`, approvals, `[instructions]`, `[developer_instructions]`, `[hooks]`) without pretending the Claude schema applies.
3. **Cross-ecosystem copy actions.** Add explicit copy/sync affordances for settings, MCP, hooks, and skills now that both sides are first-party.
4. **Hooks port.** Translator table from Claude `settings.json[hooks]` → Codex `config.toml[[hooks.*]]`. Locked event-name table sourced from `codex-rs/config/src/hook_config.rs:16-29` (PreToolUse, PermissionRequest, PostToolUse, SessionStart, UserPromptSubmit, Stop — same set).
5. **Slash-command-to-skill converter.** Best-effort `.claude/commands/foo.md` → `.codex/skills/foo/SKILL.md` with frontmatter wrapping.
6. **Rules follow-up.** `proofd sync` now generates Claude Markdown snapshots plus `.codex/rules/agent-proofs.rules`; remaining work is any future UI affordance for surfacing that generated Codex policy.

## Test status (after first-party Codex UI completion)

- `tsc --noEmit` clean
- `cargo check` clean (existing warning: `CliAdapter::kind` is unused)
- `npm test` clean (1089 tests, 6 skipped)
- `cargo test` clean (142 lib tests + 6 discover-audit tests + doc tests)
