---
paths:
  - "src/lib/tomlHighlight.ts"
---

# src/lib/tomlHighlight.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## TOML Parsing and Highlighting
Codex Settings pane TOML editing: smol-toml wrapper for parse + flattenTomlKeys (dotted-path leaves and parents); line-by-line homegrown highlighter mirroring SettingsPane's JSON highlighter classes.

- [TO-02 L19] highlightToml is a syntax overlay (not a validator) emitting span classes (sh-key, sh-string, sh-number, sh-bool, sh-comment, sh-section, sh-datetime) that mirror highlightJson. Strategy: line-by-line tokenize. Multi-line basic ('"""') and literal ("'''") strings tracked across lines via inMultiBasic/inMultiLiteral flags; countTripleDelims toggles state when an odd number of triple delimiters appears on a line. tokenizeLine: section header detected first ([name] or [[name]] up to first matching ] / ]]); strings either single-line (walk to next unescaped delim) or open-only triple-delim (consume rest of line); comments consume to EOL; bare keys match /^[A-Za-z0-9_\-.]+(?=\s*=)/; RFC-3339 datetime + numbers (incl. 0x/0o/0b prefixes); booleans true/false bounded by isIdentChar. HTML metacharacters are escaped (& -> &amp;, < -> &lt;, etc.) before tokenize so output is safe to drop into innerHTML.
