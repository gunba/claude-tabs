---
paths:
  - "src/components/ConfigManager/PromptsTab.css"
---

# src/components/ConfigManager/PromptsTab.css

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Config Editors

- [CM-28 L39] PromptsTab uses three subtabs: My Prompts, Observed Prompts, and Rules. The Observed Prompts tab keeps a sidebar of captured prompts plus a main pane with a single always-editable textarea seeded to rules-applied text. An observedBaseline state variable is captured at seed time (sidebar click or rule-driven reseed); the 'edited' indicator and Generate Rules button appear only when observedEditText !== observedBaseline, so rule toggles elsewhere do not spuriously mark the pane dirty. When the user clicks Generate Rules, generateRulesAndConflicts() produces a GeneratedChangeset; the textarea is replaced by a RulePreview pane listing rules-to-add and rules-to-delete with confirm/cancel buttons. Confirming advances observedBaseline to observedEditText, clearing the edited flag. The Rules list lives on its own standalone subtab. Rule card headers use type-aware rendering via classifyRule(): Remove rules show full-width pattern text with red tint; Replace rules show pattern -> replacement at 50/50 split; Add rules show anchor + added text at 50/50 split with a + arrow.
