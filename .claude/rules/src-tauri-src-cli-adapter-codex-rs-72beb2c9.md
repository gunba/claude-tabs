---
paths:
  - "src-tauri/src/cli_adapter/codex.rs"
---

# src-tauri/src/cli_adapter/codex.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Codex CLI Adapter

- [CC-03 L114] PermissionMode-to-Codex-flag mapping in codex.rs is locked/documented: Default -> --sandbox workspace-write; AcceptEdits -> --sandbox workspace-write --ask-for-approval never; BypassPermissions -> --dangerously-bypass-approvals-and-sandbox; DontAsk -> --sandbox workspace-write --ask-for-approval never (pinned explicitly so future Codex default changes can't weaken semantics); PlanMode -> --sandbox read-only --ask-for-approval untrusted; Auto -> --full-auto.
- [CC-05 L280] system_prompt -> instructions config override (replaces OpenAI Responses base instructions); append_system_prompt -> developer_instructions config override (additive developer-role message). codex_system_instructions(cfg) returns trimmed cfg.system_prompt if non-empty; codex_developer_instructions(cfg) returns trimmed cfg.append_system_prompt if non-empty. Both pushed via -c <key>=<value> args, value quoted via quote_toml_value (serde_json::to_string for correct Unicode + newline + quote escaping).
