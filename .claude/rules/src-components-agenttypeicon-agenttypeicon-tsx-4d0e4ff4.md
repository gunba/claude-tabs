---
paths:
  - "src/components/AgentTypeIcon/AgentTypeIcon.tsx"
---

# src/components/AgentTypeIcon/AgentTypeIcon.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## CLI Visual Identity

- [CV-05 L11] AgentTypeIcon maps a subagent_type string to an inline SVG icon for subagent cards, activity-panel inline indicators, and header visualizer subagent sprites. Built-in mapping: general-purpose -> IconSparkles, Explore -> IconCompass, Plan -> IconClipboard, claude-code-guide -> IconBookOpen, statusline-setup -> IconTerminal, verification -> IconShieldCheck; unknown/user-defined agents fall back to IconBot. SVGs use currentColor; consumers choose provider color (Claude via var(--cli-claude), Codex via var(--cli-codex)) rather than hardcoding every subagent as Claude.
