---
paths:
  - "src/hooks/tapActivityTracker.ts"
---

# src/hooks/tapActivityTracker.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Codex File Activity
Codex-derived file activity from apply_patch and parsed exec command telemetry.

- [CP-01 L21] tapActivityTracker.parseApplyPatchFiles parses apply_patch tool input text by splitting on newlines and matching '*** (Add|Update|Delete) File: <path>' markers. Matched paths are resolved relative to the session workingDir unless already absolute, canonicalized, and fed to activityStore.addFileActivity with kind created/modified/deleted respectively. Called from ToolInput(apply_patch) event handling.
  - Source anchor is src/hooks/tapActivityTracker.ts near parseApplyPatchFiles and the ToolInput(apply_patch) branch.
- [CP-02 L406] codexParsedCommandActivities maps Codex exec_command_end parsed_cmd records into activity entries: read -> kind=read/isFolder=false, list_files and search -> kind=searched/isFolder=true, relative paths resolve against the command cwd, absolute/tilde/drive-letter paths are canonicalized directly, and unknown parsed command types are ignored. tapActivityTracker consumes CodexToolCallComplete.parsedCmd with event.cwd falling back to the session workingDir and writes those operations through activityStore.addFileActivity with the normalized Codex tool name.
  - This path uses Codex's structured parsed_cmd telemetry instead of re-tokenizing shell strings for command types Codex already recognized. The helper is covered by src/lib/__tests__/codexParsedCommandActivity.test.ts.

## Data Flow

- [DF-12 L380] parseBashFiles tokenizes a Bash command string with shell-quote and walks per-statement registries to extract file activity. Mutation commands: rm (deleted), rmdir (deleted+isFolder), mv (sources=deleted, dest=created), cp (dest=created), touch (created), mkdir (created+isFolder), tee (created or modified with -a), ln (link=created), and > / >> redirections (created/modified) and < (read). Read commands (kind=read): cat, bat, less, more, nl, wc, file, stat, readlink, realpath, head, tail, sed, awk. Search commands (kind=searched, isFolder=isFolderLike): rg, grep (handles --files/--files-with-matches/-l files-mode and -e/-f/--regexp/--file pattern-from-option), fd, find, ls, tree. stripOptions strips long/short options with values per-command via OptionSpec. looksLikePath rejects flag tokens, env-var assignments (VAR=value), nul bytes, '*' / '**'. looksLikeFilePath: basename has dot AND base != '.'/'..'; isFolderLike: '.', '..', trailing slash, or not file-like. joinPath canonicalizes after collapsing './' and resolving '.' to cwd. Splits compound commands on &&, ||, ;, |, &, |&, ;;, (, ). Skips options (tokens starting with -), handles sudo/doas prefixes. Heuristic: subshells, variable expansion, and globs are not handled. Called by useTapEventProcessor on ToolInput(Bash); path existence is validated by confirmEntries on settled-idle.
