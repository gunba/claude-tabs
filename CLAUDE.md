# Claude Tabs

IMPORTANT: Working with an external application means we are developing around a moving target. Do not guess or assume how it works.
- The Claude Code source itself (4/1/2026) is available here [C:\Users\jorda\PycharmProjects\claude_tabs]. 
- For anything else, ask the user to log some test data. Logs are at [AppData\Local\claude-tabs\sessions], depending on what logging the user has enabled.

Tauri v2 desktop app managing multiple Claude Code CLI sessions in tabs. Rust backend + React/TypeScript frontend. No API key — uses the Claude Code CLI directly.

# Workflow

The user launches with `claude -w` for isolated worktrees. A SessionStart hook automatically sets up shared build dependencies. Do NOT call EnterWorktree — the user has already done this.

The user will run `/r`, `/j`, `/b` when ready. Do not run these automatically.

# Planning

When in plan mode, after you have drafted your plan but before presenting it to the user: ask whether plan critique should run via the Claude `plan-critic` agent, a Codex subprocess, or both.

Before either critique path, prepare a critique packet that includes:
- the relevant recent user correspondence in the user's own words where scope, constraints, non-goals, or corrections matter
- the draft plan

Do not reduce the user's request to only your own paraphrase when preparing critique input. The critic must be able to judge whether the draft plan actually addresses what the user asked for.

If Codex is selected, save the draft plan and the user correspondence to `plans/`, then run `python "$HOME/.claude/agent-proofs/bin/codex_delegate.py" plan --plan-file <plan-path> --user-correspondence-file <user-path>`. The Codex handoff preloads proofd rule context for plan and review workflows. If more rule detail is needed in a read-only subprocess, prefer direct reads of `CLAUDE.md` and relevant `.claude/rules/*.md` files or use `proofd` MCP only when it is already configured.
If you launch Codex plan critique in the background, you must actually wait for the task-notification before continuing. Do not present the draft plan, do not finalize, and do not reply as though the critique is optional. The critique result is on the critical path and must be incorporated before the plan is shown to the user. It is normal for this wait to take up to 30 minutes; treat that as expected rather than as a reason to conclude the step early.

If Claude is selected, spawn the `plan-critic` agent and pass both the draft plan and the relevant user correspondence. Incorporate the feedback into the final plan, then present to the user.

When review is delegated to Codex in `/r` or `/rj`, the same rule applies: if the review subprocess runs in the background, you must remain blocked on the task-notification before continuing. Do not present a final review result, do not begin janitor or finalization work that depends on the review, and do not treat the review as optional. It is normal for a Codex review wait to take up to 30 minutes.

For long-running Bash commands such as Codex delegates or builds, launch them with `run_in_background: true`. The immediate launch response only means the task started; it is not completion, and the timeout is only an upper bound on how long the subprocess may run. Do NOT use TaskOutput to poll. Wait for task-notifications, then read the referenced `<output-file>` if you need the completed command output. If the background result is required to complete the current workflow step, remain blocked on that notification instead of concluding the step early.

# Documentation

All tagged documentation is managed by `proofd`. Canonical rule data lives outside the repo in the proofd knowledge base. `.claude/rules/` is automatically generated output for Claude Code auto-loading.

Do not hand-edit `.claude/rules/*.md`. Use `python "$HOME/.claude/agent-proofs/bin/proofd.py"` subcommands to create rules, add entries, split rules, record verifications, and regenerate the rule output.

`python "$HOME/.claude/agent-proofs/bin/proofd.py" sync` regenerates local `.claude/rules/*.md` files on disk. Those files are generated, gitignored, and disposable. Their absence from `git status` is expected; the canonical proof update lives in the external proofd KB plus any source tag comments or code changes in the repo.
Generated rule markdown intentionally omits `Files:` lines. If you need the anchored files for a tag, use `python "$HOME/.claude/agent-proofs/bin/proofd.py" entry-files --tag <TAG>`.

Tags are embedded in source code as `// [TAG] brief description` comments at implementation sites. Tags must be allocated by `proofd`; agents must not invent tag IDs themselves.

Useful commands:
- `python "$HOME/.claude/agent-proofs/bin/proofd.py" import-legacy --sync` — import the old rules/proofs once and generate current rule markdown
- `python "$HOME/.claude/agent-proofs/bin/proofd.py" sync` — regenerate `.claude/rules`
- `python "$HOME/.claude/agent-proofs/bin/proofd.py" lint` — audit rules, anchors, and auto-load coverage
- `python "$HOME/.claude/agent-proofs/bin/proofd.py" entry-files --tag <TAG>` — show anchored files and source hits for one tag
- `python "$HOME/.claude/agent-proofs/bin/proofd.py" select-matching <paths...>` — select likely relevant entries for proving
- `python "$HOME/.claude/agent-proofs/bin/codex_delegate.py" <workflow> ...` — run a Codex subprocess for review, janitor, build, combined `/rj`, or plan critique
