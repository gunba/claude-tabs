---
paths:
  - "src/lib/codexSchema.ts"
---

# src/lib/codexSchema.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Codex Settings Schema Frontend
JSON Schema -> SettingField[] flattening for the Codex Settings reference panel. Reuses the SettingField shape from settingsSchema.ts so the React UI is shared.

- [CG-02 L146] Schema normalize() pipeline pre-processes each property: resolveRef walks {$ref:'#/definitions/<Name>'} against root.definitions (preserving description/default from the referencing site); unwrapAllOf collapses {allOf:[{$ref:...}]} (schemars' way of attaching descriptions to a referenced type); unwrapNullableAnyOf strips {anyOf:[{type:X},{type:'null'}]} for Option<T> fields, and collapses multi-variant const-only enums to {type:'string', enum:[<consts...>]}. getCodexUnknownKeys accepts dotted keys whose top-level segment matches any schema entry's first segment (covers bare parents AND deeper nesting like shell_environment_policy.set.OPENAI_API_KEY whose middle table isn't enumerated) plus all additionalProperties-keyed tables. getCodexTypeMismatches recurses into nested objects so leaves like shell_environment_policy.inherit=5 are flagged.
- [CG-01 L227] parseCodexJsonSchema walks the schema's top-level properties: additionalProperties-keyed tables (mcp_servers, profiles, plugins, model_providers, projects, marketplaces, features) emit a single 'managed-elsewhere' stub with no click-to-insert and a hint to the dedicated pane (MCP Servers tab / Plugins tab / launcher profile picker / etc.). Typed objects (type=='object' with explicit properties) flatten one level: each child emitted as 'parent.child' (shell_environment_policy.inherit, history.persistence). Scalars emit as direct keys. categorizeTopLevel maps to the Codex-specific category bucket order [model, sandbox, approval, shell-env, mcp, agents, memories, history, tools, ui, experimental, workspace, notifications, managed-elsewhere, advanced]. defaultForCodexType: enum -> first choice, boolean -> true (opt-in change), number -> 0, string -> '', stringArray -> [], stringMap/object -> {}. buildCodexSettingsSchema(jsonSchema) returns [] when jsonSchema is null.
