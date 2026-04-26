---
paths:
  - "src/lib/tomlParse.ts"
---

# src/lib/tomlParse.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## TOML Parsing and Highlighting
Codex Settings pane TOML editing: smol-toml wrapper for parse + flattenTomlKeys (dotted-path leaves and parents); line-by-line homegrown highlighter mirroring SettingsPane's JSON highlighter classes.

- [TO-01 L1] parseToml is a thin smol-toml wrapper returning {ok:true,value} for blank input (treats empty/whitespace-only as a valid empty table) or any successful parse; {ok:false,error} on parse error. flattenTomlKeys walks the parsed object emitting dotted-path keys for every leaf AND every intermediate table (so 'shell_environment_policy' AND 'shell_environment_policy.inherit' both appear). Arrays of inline tables emit only the parent path; per-entry leaf paths inside [[mcp_servers.docs.tools]] aren't tracked because users add those via dedicated panes. additionalProperties-keyed tables emit parent + user-chosen child names so their existence shows even when the reference panel doesn't expose click-to-insert for them.
