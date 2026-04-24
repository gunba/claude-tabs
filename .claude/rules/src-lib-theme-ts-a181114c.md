---
paths:
  - "src/lib/theme.ts"
---

# src/lib/theme.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Command Bar

- [CB-12 L145] Heat gradient 5-tier WoW rarity scale heat-0..heat-4 (common=white, uncommon=green, rare=blue, epic=purple, legendary=orange). Tiers assigned by rank-based quartiles over used commands: unused commands get heat-0 (common/white). CSS classes use color-mix() with --rarity-* CSS variables defined in applyTheme(). source: src/components/CommandBar/CommandBar.css:L126; src/lib/claude.ts:L254; src/lib/theme.ts:L145

## Theme System

- [TH-01 L4] All colors are CSS custom properties on `:root` — components use CSS variables, not hardcoded hex (exception: model rarity colors in `claude.ts` are fixed hex for cross-theme consistency). Applied at startup via `applyTheme()`. xterm.js colors from `getXtermTheme()` reading CSS variables.
- [TH-02 L5] Key variables: `--bg-primary`, `--bg-surface`, `--accent` (clay), `--accent-secondary` (blue), `--accent-tertiary` (purple), `--term-bg`, `--term-fg`
- [TH-03 L141] Font system: --font-ui (Inter variable + system fallback) and --font-mono defined in index.html :root block as initial fallback (Cascadia Code + Fira Code + JetBrains Mono). applyTheme() overrides --font-mono at runtime to 'Pragmasevka', 'Roboto Mono', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', monospace (matching TERMINAL_FONT_FAMILY in useTerminal.ts; emoji fonts appended by commit 4212d41 to prevent wide-char ghosting). Inter woff2 bundled in src/assets/fonts/ with @font-face. source: src/lib/theme.ts:L141,L143
