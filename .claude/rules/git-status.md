---
paths:
  - "src/hooks/useGitStatus.ts"
---

# Git Integration

<!-- Codes: GS=Git Integration -->

- [GS-01] useGitStatus keeps isGitRepo and status visible during workingDir transitions (tab switches) — only resets them when workingDir is null/empty, git_repo_check returns false, or the check throws. This prevents the Changes button in StatusBar from blinking off during the async git_repo_check round-trip (~100ms).
  - Files: src/hooks/useGitStatus.ts
