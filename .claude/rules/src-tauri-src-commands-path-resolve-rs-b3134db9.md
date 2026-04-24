---
paths:
  - "src-tauri/src/commands/path_resolve.rs"
---

# src-tauri/src/commands/path_resolve.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Rust System Command Modules

- [RT-03 L255] resolve_paths: async Tauri command (path_resolve.rs) resolving terminal-derived path tokens against a session cwd. Two-phase: (1) literal resolution (~-expansion, absolute, cwd-join); (2) TTL-cached (60s) subtree file index via WalkBuilder (hidden files/dirs filtered, gitignore respected, node_modules/target/dist/build/vendor/__pycache__ skipped, max depth 12, cap 100k files). Index keyed by normalized cwd in a LazyLock<Mutex<HashMap>>. lookup_in_index: bare basename uses by_basename map; subpath uses suffix-match on all files. Shortest-path (fewest components) wins on ambiguous matches. Returns Vec<ResolvedPath> with candidate, absPath, isDir. source: src-tauri/src/commands/path_resolve.rs:L237
