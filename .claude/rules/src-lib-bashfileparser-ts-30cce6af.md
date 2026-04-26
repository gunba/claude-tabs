---
paths:
  - "src/lib/bashFileParser.ts"
---

# src/lib/bashFileParser.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Data Flow

- [DF-12 L307] parseBashFiles tokenizes a Bash command string with shell-quote and walks per-statement registries to extract file activity. Mutation commands: rm (deleted), rmdir (deleted+isFolder), mv (sources=deleted, dest=created), cp (dest=created), touch (created), mkdir (created+isFolder), tee (created or modified with -a), ln (link=created), and > / >> redirections (created/modified) and < (read). Read commands (kind=read): cat, bat, less, more, nl, wc, file, stat, readlink, realpath, head, tail, sed, awk. Search commands (kind=searched, isFolder=isFolderLike): rg, grep (handles --files/--files-with-matches/-l files-mode and -e/-f/--regexp/--file pattern-from-option), fd, find, ls, tree. stripOptions strips long/short options with values per-command via OptionSpec. looksLikePath rejects flag tokens, env-var assignments (VAR=value), nul bytes, '*' / '**'. looksLikeFilePath: basename has dot AND base != '.'/'..'; isFolderLike: '.', '..', trailing slash, or not file-like. joinPath canonicalizes after collapsing './' and resolving '.' to cwd. Splits compound commands on &&, ||, ;, |, &, |&, ;;, (, ). Skips options (tokens starting with -), handles sudo/doas prefixes. Heuristic: subshells, variable expansion, and globs are not handled. Called by useTapEventProcessor on ToolInput(Bash); path existence is validated by confirmEntries on settled-idle.
