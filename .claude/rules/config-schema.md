---
paths:
  - "src/lib/settingsSchema.ts"
  - "src/lib/paths.ts"
  - "src/components/ConfigManager/SettingsTab.*"
  - "src/components/ConfigManager/ProvidersPane.*"
---

# Config Schema and Providers

<!-- Codes: CM=Config Manager -->

- [CM-02] formatScopePath() normalizes backslashes to forward slashes and abbreviates project-scope paths via abbreviatePath(). User-scope paths (~/...) pass through unchanged.
  - Files: src/lib/paths.ts
- [CM-03] Project directory selector: when multiple working dirs exist across sessions, the config modal header shows a dropdown to switch between project-level scopes. settingsSchema.ts builds the schema; fetch_settings_schema provides the Rust backend.
  - Files: src/lib/settingsSchema.ts, src-tauri/src/commands.rs
- [CM-08] Save via Rust read_config_file/write_config_file commands (JSON validated before write, parent dirs auto-created).
- [CM-10] Settings schema cached in localStorage (binarySettingsSchema) to avoid re-scanning on every startup.
- [CM-17] StatusBar hooks button opens config manager directly to Hooks tab. Store: showConfigManager is string|false (tab name or closed).
  - Files: src/components/StatusBar/StatusBar.tsx, src/store/settings.ts
- [CM-22] ThreePaneEditor scope headers show actual file paths per tab (e.g. ~/.claude/settings.json, {dir}/CLAUDE.md, {dir}/.claude/agents/) instead of generic directory stubs. Paths normalized to forward slashes via formatScopePath().
  - Files: src/components/ConfigManager/ThreePaneEditor.tsx, src/lib/paths.ts
- [CM-24] Unified Settings Reference: full-width panel below the 3 editor columns, alphabetically sorted in a 3-column CSS grid (left-to-right flow). Type badges (boolean=blue, string=green, number=purple, enum=purple, array=yellow, object=clay), search/filter, click-to-insert into the active scope editor, 2-line CSS-clamped descriptions with full text on hover, isSet highlight when key exists in active scope. Collapse state persisted to localStorage.
  - Files: src/components/ConfigManager/SettingsTab.tsx, src/components/ConfigManager/SettingsPane.tsx
