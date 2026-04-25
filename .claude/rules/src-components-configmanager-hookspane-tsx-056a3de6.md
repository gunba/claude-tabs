---
paths:
  - "src/components/ConfigManager/HooksPane.tsx"
---

# src/components/ConfigManager/HooksPane.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Hooks Manager

- [HM-05 L8] Custom events: event dropdown includes a "Custom event..." option with freeform text input, so users aren't locked to the hardcoded event list
- [HM-09 L32] Three hook types supported: `command`, `prompt`, `agent`
- [HM-01 L77] Three scopes: User (`~/.claude/settings.json`), Project (`.claude/settings.json`), Project Local (`.claude/settings.local.json`)
- [HM-03 L78] Non-destructive saves: merges hooks into existing settings file (preserves other keys like `permissions`)
- [HM-06 L111] Existing hooks with unknown event names (from file) are displayed and editable
- [HM-04 L140] Edit preserves unknown fields: editing a hook spreads the original entry before applying form values, so fields added by future CLI versions are not stripped
- [HM-12 L300] Hook form includes an optional 'if' field (permission-rule syntax filter, placeholder 'Bash(git *)'). Saved as the 'if' key on HookEntry when non-empty, omitted (undefined) when blank. Populated from flat.hook['if'] on edit. Displayed as an 'If:' row on hook cards when set. The field is outside the eventHasMatcher conditional and applies to all event types.

## Config Editors

- [CM-15 L76] HooksPane: per-scope CRUD absorbed from standalone HooksManager. Hook cards, inline Add/Edit form. Scope is a prop, not a dropdown. Calls bumpHookChange() after save.
