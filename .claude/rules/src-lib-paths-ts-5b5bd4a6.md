---
paths:
  - "src/lib/paths.ts"
---

# src/lib/paths.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Activity Panel

- [AP-01 L32] canonicalizePath() in paths.ts converts any path to a stable forward-slash form for identity comparisons: backslashes -> forward slashes, MSYS-style /c/Users/ -> C:/Users/, drive letter normalized to uppercase, trailing slashes stripped. Used at ingress in useTapEventProcessor (ToolInput file_path, InstructionsLoadedEvent, PermissionRejected) and the passive git change scan (absolutized paths from git_list_changes) to ensure cross-platform path identity.

## Claude Tabs Worktree Paths

- [CU-01 L54] parseWorktreePath in src/lib/paths.ts matches both '.claude_tabs/worktrees/<name>' and legacy '.claude/worktrees/<name>' paths via the regex /^(.+)\/\.(?:claude_tabs|claude)\/worktrees\/([^/]+)\/?$/. Returns {projectRoot, worktreeName, projectName}. Settings store mock and workspace-key collapsing tests in paths.test.ts mirror both regex branches. Used in settings store (setSavedDefaults workspace key), ConfigManager, SessionLauncher, and useTapEventProcessor.

## Config Implementation

- [CI-02 L213] formatScopePath() normalizes backslashes to forward slashes and abbreviates project-scope paths via abbreviatePath(). User-scope paths (~/...) pass through unchanged.

## Config Schema and Providers

- [CM-02 L212] formatScopePath() normalizes backslashes to forward slashes and abbreviates project-scope paths via abbreviatePath(). User-scope paths (~/...) pass through unchanged.

## Platform

- [PL-02 L15] IS_LINUX export in src/lib/paths.ts mirrors the IS_WINDOWS detection pattern: checks process.platform === 'linux' (Node/vitest) OR navigator.platform.startsWith('Linux') (Tauri WebView). Both IS_LINUX and IS_WINDOWS are exported from paths.ts and imported wherever platform-specific behavior is needed (App.tsx for titlebar/decorations, useTerminal.ts for paste blocker).

## Data Flow

- [DF-09 L122] groupSessionsByDir() in paths.ts is the pure tab-grouping helper: groups sessions by normalized workingDir using a Map for O(n) single-pass insertion-order grouping; worktrees collapse into project root via parseWorktreePath. TabGroup type exported. Tab-order and drag-reorder data flow lives alongside in the same module under DF-14.
- [DF-14 L139,148,175] Pure drag-and-drop reorder helpers in src/lib/paths.ts: sideFromMidpoint(clientX, rect) returns 'before' / 'after' from cursor X vs target midpoint (strict <, so the midpoint maps to 'after'). computeTabReorder(order, sourceId, targetId, side, groups) computes the new flat session order for a within-group tab drag and returns null on no-op (cross-group target, missing ids, or already at the resulting position via the adjustedInsert === fromIndex guard). computeGroupReorder(order, sourceKey, targetKey, side, groups) splices the entire source-group session block to before/after the target group's first/last session and returns null on no-op (same group, missing group, empty source, anchor missing, or identity-equal next array). All three are pure and unit-tested in src/lib/__tests__/paths.test.ts.
  - TabBar.tsx delegates to these helpers in handleTabDragOver/handleTabDrop and handleGroupDragOver/handleGroupDrop; the helpers' null return is the single source of truth for both indicator suppression and drop suppression.
