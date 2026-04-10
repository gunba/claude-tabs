---
paths:
  - "src/lib/promptDiff.ts"
---

# src/lib/promptDiff.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Config Editors

- [CM-26 L1] promptDiff.ts: pure utility library for system prompt diffing and rule generation. Exports: escapeRegex (escape all regex metacharacters for literal matching), unescapeRegex (reverses escapeRegex for display), diffLines (LCS-based line diff returning same/add/del segments), applyRulesToText (applies SystemPromptRule[] regex replacements to prompt text, mirrors Rust proxy replace_all behavior), generateRulesFromDiff (creates add/remove/replace rules from a diff, deduplicates against existing rules), classifyRule (classifies a rule as remove/add/replace with human-readable displayLeft/displayRight text), RuleClassification (exported interface for classifyRule return value). stripAnchors is private. Used by PromptsTab to preview prompt changes, apply enabled rules, and auto-generate rules.
