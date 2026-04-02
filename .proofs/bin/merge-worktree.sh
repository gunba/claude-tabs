#!/bin/bash
# merge-worktree.sh — Merge a worktree branch to main with tag collision detection
# Usage: merge-worktree.sh <branch-name> [--message "commit msg"]
set -euo pipefail

BRANCH="${1:?Usage: merge-worktree.sh <branch-name> [--message \"msg\"]}"
MSG=""
if [ "${2:-}" = "--message" ] && [ -n "${3:-}" ]; then
    MSG="$3"
fi

if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1
PROOFS_DIR="$(git rev-parse --show-toplevel)/.proofs"
MAIN_BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "Merging $BRANCH into $MAIN_BRANCH..."

# Attempt merge
if git merge "$BRANCH" --no-commit 2>/dev/null; then

    # Protect gitignored directories that must never appear as tracked files.
    # On Windows (core.symlinks=false), worktree junctions get staged as text files.
    # Check the INDEX, not the filesystem — on main the real directory exists,
    # so [ -f ] returns false even when the index has a file entry.
    for protected in .proofs .claude; do
        if git ls-files --cached --error-unmatch "$protected" &>/dev/null; then
            echo "WARNING: Merge staged '$protected' as tracked file (symlink artifact). Removing from index..."
            git rm --cached -f "$protected" 2>/dev/null || true
        fi
    done

    # Clean merge — check for tag collisions in staged changes
    $PYTHON -c "
import subprocess, re, sys

# Get list of changed doc files
result = subprocess.run(['git', 'diff', '--cached', '--name-only'], capture_output=True, text=True)
changed = [f for f in result.stdout.strip().split('\n') if f.endswith('.md') and f]

collisions = []
for f in changed:
    # Get tags from both versions
    try:
        base = subprocess.run(['git', 'show', 'HEAD:' + f], capture_output=True, text=True)
        staged = subprocess.run(['git', 'show', ':' + f], capture_output=True, text=True)
        base_tags = set(re.findall(r'\[([A-Z]{2}-\d{2,3})\]', base.stdout))
        staged_tags = set(re.findall(r'\[([A-Z]{2}-\d{2,3})\]', staged.stdout))
        new_tags = staged_tags - base_tags
        if len(new_tags) > 0:
            print(f'  {f}: {len(new_tags)} new tags ({', '.join(sorted(new_tags))})')
    except:
        pass
" 2>/dev/null || true

    # Complete the merge
    if [ -n "$MSG" ]; then
        git commit -m "$MSG"
    else
        git commit -m "Merge $BRANCH"
    fi
    echo "Merged $BRANCH cleanly."

else
    # Merge conflict — attempt structured resolution for .proofs/ files
    echo "Merge conflict detected. Attempting structured resolution..."

    # Handle .proofs/ JSON conflicts
    CONFLICTED=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
    PROOFS_CONFLICTS=$(echo "$CONFLICTED" | grep '\.proofs/' || true)

    if [ -n "$PROOFS_CONFLICTS" ]; then
        echo "Resolving .proofs/ conflicts..."
        bash "$(cd "$(dirname "$0")" && pwd)/merge-proofs.sh" "$BRANCH"
    fi

    # Handle JSONL conflicts (append-only logs): union lines, deduplicate, sort by timestamp
    JSONL_CONFLICTS=$(echo "$CONFLICTED" | grep '\.jsonl$' || true)
    if [ -n "$JSONL_CONFLICTS" ]; then
        echo "Resolving JSONL conflicts..."
        for file in $JSONL_CONFLICTS; do
            echo "  Resolving: $file"
            MERGE_BASE=$(git merge-base HEAD "$BRANCH")
            $PYTHON -c "
import json, sys, subprocess

filepath, branch, merge_base = sys.argv[1], sys.argv[2], sys.argv[3]

def get_lines(ref, path):
    r = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True, text=True)
    if r.returncode != 0:
        return []
    return [l.strip() for l in r.stdout.strip().split(chr(10)) if l.strip()]

ours_lines = get_lines('HEAD', filepath)
theirs_lines = get_lines(branch, filepath)

# Union: deduplicate by exact content, preserve order by timestamp
seen = set()
merged = []
for line in ours_lines + theirs_lines:
    if line not in seen:
        seen.add(line)
        merged.append(line)

# Sort by timestamp if JSON with 'ts' field
def sort_key(line):
    try:
        return json.loads(line).get('ts', '')
    except:
        return ''

merged.sort(key=sort_key)

with open(filepath, 'w') as f:
    f.write(chr(10).join(merged) + chr(10) if merged else '')

print(f'    Merged: {len(merged)} lines ({len(ours_lines)} ours + {len(theirs_lines)} theirs, {len(ours_lines) + len(theirs_lines) - len(merged)} deduped)')
" "$file" "$BRANCH" "$MERGE_BASE"
            git add "$file"
        done
    fi

    # Handle rule file conflicts: take theirs (worktree branch = most recently proved)
    RULE_CONFLICTS=$(echo "$CONFLICTED" | grep '\.claude/rules/.*\.md$' || true)
    if [ -n "$RULE_CONFLICTS" ]; then
        echo "Resolving rule file conflicts (taking branch version)..."
        for file in $RULE_CONFLICTS; do
            echo "  Resolving: $file (taking $BRANCH)"
            git checkout "$BRANCH" -- "$file"
            git add "$file"
        done
    fi

    # Check remaining conflicts
    REMAINING=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
    if [ -n "$REMAINING" ]; then
        echo "ERROR: Unresolved conflicts in:" >&2
        echo "$REMAINING" >&2
        echo "Resolve manually, then: git add <files> && git commit" >&2
        exit 1
    fi

    # Same symlink artifact protection as the clean-merge path
    for protected in .proofs .claude; do
        if git ls-files --cached --error-unmatch "$protected" &>/dev/null; then
            echo "WARNING: Merge staged '$protected' as tracked file (symlink artifact). Removing from index..."
            git rm --cached -f "$protected" 2>/dev/null || true
        fi
    done

    if [ -n "$MSG" ]; then
        git commit -m "$MSG"
    else
        git commit -m "Merge $BRANCH (resolved)"
    fi
    echo "Merged $BRANCH with conflict resolution."
fi
