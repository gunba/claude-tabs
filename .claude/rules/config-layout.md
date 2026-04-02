---
paths:
  - "src/components/ConfigManager/ConfigManager.*"
  - "src/components/ConfigManager/ThreePaneEditor.*"
---

# Config Layout

<!-- Codes: CM=Config Manager -->

- [CM-01] Config modal header uses CSS grid (1fr auto 1fr) instead of flexbox space-between, so tab row stays centered regardless of left (title) or right (project selector + close) content width.
  - Files: src/components/ConfigManager/ConfigManager.css, src/components/ConfigManager/ConfigManager.tsx
- [CM-04] Keystrokes blocked via shared ModalOverlay component (onKeyDown stopPropagation); Escape and Ctrl+, pass through to global handler.
- [CM-05] Claude and Hooks tabs use ThreePaneEditor with 3 columns (User/Project/Local). Agents and Skills tabs use ThreePaneEditor with 2 columns (User/Project only -- no local scope). Plugins tab uses dedicated PluginsTab component (single-pane, CLI-driven). Prompts tab uses dedicated PromptsTab component (single-pane). Settings tab uses dedicated SettingsTab with unified reference panel.
  - Files: src/components/ConfigManager/ConfigManager.tsx
- [CM-09] Escape closes modal; clicking overlay closes modal.
- [CM-11] Wide modal (84vw, max 1500px, 78vh) with 9 tabs: Settings, Env Vars, Claude, Hooks, Plugins, Agents, Prompts, Skills, Providers. All tabs render at full width. Store value controls which tab opens.
  - Files: src/components/ConfigManager/ConfigManager.tsx, src/components/ConfigManager/ConfigManager.css
- [CM-12] ThreePaneEditor: supports optional scopes prop to control visible columns. Claude/Hooks use all 3 scopes (User/Project/Local). Agents/Skills use 2 scopes (User/Project). Color coded: User=clay, Project=blue, Local=purple (left border + tinted header).
  - Files: src/components/ConfigManager/ThreePaneEditor.tsx, src/components/ConfigManager/ConfigManager.css
- [CM-18] Config tabs use inline SVG icons (gear, document, hook, puzzle, bot, skill, lightning, braces, close) instead of emoji -- monochrome, consistent cross-platform.
  - Files: src/components/ConfigManager/ConfigManager.tsx
- [CM-20] Tab label reads "Claude" instead of "CLAUDE.md" for the markdown editor tab.
  - Files: src/components/ConfigManager/ConfigManager.tsx
