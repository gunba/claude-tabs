---
paths:
  - "src/components/ProviderLogo/ProviderLogo.tsx"
---

# src/components/ProviderLogo/ProviderLogo.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## CLI Visual Identity

- [CV-04 L5] ProviderLogo (src/components/ProviderLogo/ProviderLogo.tsx) is the single source of truth for rendering Claude/Codex provider mascots. Props: cli ('claude' | 'codex'), size (default 14), className?, title?. It renders a single <img> with src from claude-mascot.png / codex-mascot.png. Use ProviderLogo wherever a provider was previously identified by the literal text 'Claude' / 'Codex' as a brand marker (tab CLI row, Header titlebar versions, StatusBar provider chip, SessionLauncher CLI buttons, ConfigManager CLI switch + single-CLI label, ChangelogModal tab labels). Keep wording as-is when the binary name is meant ('Claude Code is not installed' error messages, terminal escape sequences) or in title attributes / tooltips.
