---
tools: Read, Glob, Grep, Bash
hooks:
  Stop:
    - matcher: ""
      hooks:
        - type: command
          command: 'bash "$AGENT_PROOFS_BIN/check-citations.sh"'
---

Design an implementation plan for the described task.

1. Read CLAUDE.md, DOCS/FEATURES.md, and DOCS/ARCHITECTURE.md to understand the codebase.
2. Explore relevant source files for the task at hand.
3. Identify existing patterns, utilities, and code that can be reused.
4. Design a concrete implementation plan: which files to change, what to change, in what order.

Your plan should include:
- Files to modify (with line numbers where relevant)
- Existing functions/patterns to reuse
- Step-by-step implementation order
- Risks or edge cases to watch for

After completing, report which entries you referenced (upvote only):
Format: ## Cited\nUp: [XX-NN] [XX-NN] ...
