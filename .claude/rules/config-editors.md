---
paths:
  - "src/components/ConfigManager/SettingsPane.*"
  - "src/components/ConfigManager/MarkdownPane.*"
  - "src/components/ConfigManager/HooksPane.*"
  - "src/components/ConfigManager/PluginsPane.*"
  - "src/components/ConfigManager/AgentEditor.*"
  - "src/components/ConfigManager/SkillsEditor.*"
  - "src/components/ConfigManager/EnvVarsTab.*"
  - "src/components/ConfigManager/PromptsTab.*"
---

# Config Editors

<!-- Codes: CM=Config Manager -->

- [CM-06] Per-scope raw JSON settings editor (SettingsPane) and CLAUDE.md editor (MarkdownPane) with own dirty tracking and Save per pane. Tab key inserts 2 spaces in markdown.
  - Files: src/components/ConfigManager/SettingsPane.tsx, src/components/ConfigManager/MarkdownPane.tsx
- [CM-07] Agent editor: scoped via ThreePaneEditor (user/project only -- no local scope) with agent pills at top, editor below. Auto-selects first agent on load (or enters new-agent mode if none). Textarea always visible -- no empty state. Dashed "+ new agent" pill replaces old + New button/inline form. Duplicate name validation on create. Ctrl+S dispatches to create or save based on mode. User scope scans ~/.claude/agents/, project scans {wd}/.claude/agents/.
  - Files: src/components/ConfigManager/AgentEditor.tsx, src/components/ConfigManager/ConfigManager.css
- [CM-13] SettingsPane: JSON textarea with syntax highlighting overlay (pre behind transparent textarea). Both layers use position: absolute; inset: 0 inside sh-container for proper fill. Keys=clay, strings=blue, numbers/bools=purple. Scroll synced between layers. Ctrl+S to save.
  - Files: src/components/ConfigManager/SettingsPane.tsx, src/components/ConfigManager/ConfigManager.css
- [CM-14] MarkdownPane: per-scope CLAUDE.md textarea. Tab key inserts 2 spaces. Scope-to-fileType mapping: user=claudemd-user, project=claudemd-root, project-local=claudemd-local. Local scope writes to CLAUDE.local.md at project root (Claude Code convention).
  - Files: src/components/ConfigManager/MarkdownPane.tsx
- [CM-15] HooksPane: per-scope CRUD absorbed from standalone HooksManager. Hook cards, inline Add/Edit form. Scope is a prop, not a dropdown. Calls bumpHookChange() after save.
  - Files: src/components/ConfigManager/HooksPane.tsx
- [CM-16] PluginsTab: CLI-driven plugin manager (single-pane, no ThreePaneEditor). Installed plugins as cards with toggle switch (enable/disable) and uninstall. Marketplace grid with search filter, scope selector, sort by downloads/name. Install count formatting via formatTokenCount. Graceful fallback for older CLI versions. MCP servers section for manual settings.json config.
  - Files: src/components/ConfigManager/PluginsPane.tsx, src/components/ConfigManager/ConfigManager.css
- [CM-23] MarkdownPane preview toggle: footer has Preview/Edit button (left-aligned via margin-right:auto). Preview mode renders markdown via ReactMarkdown with dark-themed styles.
  - Files: src/components/ConfigManager/MarkdownPane.tsx, src/components/ConfigManager/ConfigManager.css
- [CM-25] Settings validation footer: shows "Valid" when JSON is well-formed with all recognized keys. Unknown keys show names inline (up to 3, then "+N more") with a tooltip explaining schema source status. Type mismatches show key, expected type, and actual type. Each validation segment is a separate span so tooltips are correctly scoped.
  - Files: src/components/ConfigManager/SettingsPane.tsx, src/lib/settingsSchema.ts
- [CM-26] promptDiff.ts: pure utility library for system prompt diffing and rule generation. Exports: escapeRegex (literal regex from string), diffLines (LCS-based line diff returning same/add/del segments), applyRules (applies SystemPromptRule[] regex replacements to prompt text), generateRulesFromDiff (creates add/remove rules from a diff). Used by PromptsTab to preview prompt changes and auto-generate rules. Mirrors Rust proxy rule application logic.
  - Files: src/lib/promptDiff.ts, src/lib/__tests__/promptDiff.test.ts, src/components/ConfigManager/PromptsTab.tsx
