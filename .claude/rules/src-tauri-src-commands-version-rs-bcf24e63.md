---
paths:
  - "src-tauri/src/commands/version.rs"
---

# src-tauri/src/commands/version.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Version & Auto-Update

- [VA-03 L1] Rust version commands: get_build_info returns CARGO_PKG_VERSION + CLAUDE_CODE_BUILD_VERSION (embedded at compile time via build.rs cargo:rustc-env). check_latest_cli_version queries npm dist-tags endpoint (10s timeout). update_cli detects install method from CLI path (brew/npm/volta/binary) via detect_install_method with Windows backslash normalization, runs the appropriate update command with CREATE_NO_WINDOW on Windows.

## Platform

- [PL-01 L20] Linux custom titlebar: tauri.conf.json sets decorations:false globally. App.tsx renders the custom Header on Linux unless linux_use_native_chrome() selects native chrome; that command returns true for KDE Wayland, where App.tsx restores native decorations via setDecorations(true). default.json grants core window permissions for set-decorations plus the custom Header drag/minimize/toggle-maximize commands.
  - Confirmed by debug build console on Linux/KDE/Wayland: setDecorations(true) failed with missing core:window:allow-set-decorations before the capability was added. The fallback Header uses startDragging(), minimize(), and toggleMaximize(), so those explicit permissions are granted alongside set-decorations.

## CLI changelog modal
Per-CLI changelog viewer surfaces release notes when the installed CLI version changes between launches. Backend Rust fetches Claude raw GitHub markdown CHANGELOG.md and Codex GitHub releases atom feed; semver-aware version comparison filters entries to the gap between previous and current installed version.

- [CN-01 L39] fetch_cli_changelog Tauri command (spawn_blocking, 10s HTTP timeout) returns CliChangelog {cli, sourceUrl, fromVersion, toVersion, entries[ChangelogEntry], truncated}. claude branch fetches https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md and parses '## <version>' headings into entries; codex branch fetches https://github.com/openai/codex/releases.atom (parse_codex_atom) and falls back to the GitHub releases API (rust-v{ver} -> v{ver} -> {ver} tag attempts) if the atom feed has no matching entry. compare_versions parses semver with prerelease suffixes (alpha.1, alpha.10) and ranks pre-release < release; select_entries filters to versions strictly after fromVersion through toVersion (inclusive) and caps at 12 (or 5 default); truncate_body caps each entry body at 12000 chars. Frontend mirrors the comparison via src/lib/changelog.ts compareCliVersions/isCliVersionIncrease and renders ChangelogModal triggered from StatusBar; modal closes via Esc/X/click-outside.
  - src-tauri/src/commands/version.rs:L37 (ChangelogEntry/CliChangelog), src-tauri/src/commands/version.rs:L62 (normalize_cli_version), src-tauri/src/commands/version.rs:L72 (compare_versions), src-tauri/src/commands/version.rs:L209 (fetch_claude_changelog), src-tauri/src/commands/version.rs:L410 (fetch_codex_changelog), src-tauri/src/commands/version.rs:L449 (fetch_cli_changelog tauri command), src/lib/changelog.ts:L1 (frontend types + compare helpers), src/components/ChangelogModal/ChangelogModal.tsx:L1 (modal component), src/components/StatusBar/StatusBar.tsx (changelog trigger button)
