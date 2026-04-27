---
paths:
  - "src/components/AgentTypeIcon/AgentTypeIcon.tsx"
---

# src/components/AgentTypeIcon/AgentTypeIcon.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## CLI Visual Identity

- [CV-05 L11] AgentTypeIcon (src/components/AgentTypeIcon/AgentTypeIcon.tsx) maps a subagent_type string to an inline SVG icon for the subagent card and the activity panel inline indicator. Built-in mapping (matches the 6 default agents in /home/jordan/Desktop/Projects/claude_code/src/tools/AgentTool/builtInAgents.ts): general-purpose -> IconSparkles, Explore -> IconCompass, Plan -> IconClipboard, claude-code-guide -> IconBookOpen, statusline-setup -> IconTerminal, verification -> IconShieldCheck. Anything else (user-defined agents like reviewer / prover / summarizer / recall / rj / etc.) falls back to IconBot. Default size 12. SVGs use currentColor; the consumer sets color (e.g. .subagent-type-icon picks --cli-claude orange in the subagent card; .agent-mascot-icon picks --cli-claude in the activity panel). Subagents are always Claude in this codebase (Codex doesn't expose subagents) so the orange palette is hardcoded at the consumer side rather than parameterised.
