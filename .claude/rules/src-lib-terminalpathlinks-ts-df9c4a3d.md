---
paths:
  - "src/lib/terminalPathLinks.ts"
---

# src/lib/terminalPathLinks.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Terminal Path Links

- [TP-01 L92] createPathLinkProvider (src/lib/terminalPathLinks.ts) implements xterm.js ILinkProvider detecting file-path tokens on each terminal line using PATH_RE regex (absolute, ~, ./, ../, drive-letter, bare multi-segment subpaths like foo/bar.ts, and bare filenames like package.json). Internal segments between two slashes may contain ONE space-separated word so 'src/My Folder/file.tsx' is detected; trailing segments stay space-free so the regex never bleeds into prose. The trailing lookahead excludes [\\w.\\\\/-] but NOT ':', so 'src/App.tsx: description' style Codex output still detects 'src/App.tsx'. For unresolved candidates, batches into a single 'resolve_paths' Tauri command call (path_resolve.rs) which: (1) tries literal resolution (~/abs/cwd-joined), (2) falls back to TTL-cached (60s) subtree index (WalkBuilder, respects .gitignore, skips node_modules/target/dist/build, max depth 12, cap 100k files). Returns ILink entries with underline+pointer decorations only for resolved paths. Click: shell_open; Ctrl/Cmd+click: reveal_in_file_manager. Per-line LRU cache cap 500, cleared on cwd change. :line[:col] suffixes stripped for existence check but preserved as link text. source: src/lib/terminalPathLinks.ts:L37; src-tauri/src/commands/path_resolve.rs:L237
