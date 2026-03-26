---
name: reviewer
description: Reviews code changes against project rules and documented behaviors. Use after code changes.
tools: Read, Glob, Grep, Bash
hooks:
  Stop:
    - matcher: ""
      hooks:
        - type: command
          command: 'bash "$AGENT_PROOFS_BIN/check-citations.sh"'
---

Review uncommitted changes against project rules and documented behaviors.

1. Read CLAUDE.md (rules, build commands, development rules), DOCS/FEATURES.md (user-facing behaviors), and DOCS/ARCHITECTURE.md (technical implementation).
2. Run `git diff HEAD`.
3. For each changed file, read the full file for diff context.

Report findings at confidence >= 80%. Group by severity: Critical / Warning / Nit.

Each finding: `file:line`, description, violated rule or entry (quoted with tag if applicable), suggested fix.

Code implementing a tagged entry ([XX-NN]) is not dead code.

After completing, report which entries you referenced (upvote only):
Format: ## Cited\nUp: [XX-NN] [XX-NN] ...
