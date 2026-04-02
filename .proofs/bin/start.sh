#!/bin/bash
# start.sh — Show worktree status and recent run log
set -euo pipefail

PROOFS_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")/.proofs"
LOG_FILE="$PROOFS_DIR/runs.jsonl"
if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1
mkdir -p "$PROOFS_DIR"

# Worktree indicator
BRANCH=$(git branch --show-current 2>/dev/null || echo "?")
MAIN_TREE=$(git worktree list --porcelain 2>/dev/null | head -1 | sed 's/^worktree //')
CURRENT=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")

if [ "$MAIN_TREE" != "$CURRENT" ]; then
    echo "WORKTREE: $BRANCH (isolated from main)"

    # Ensure worktree has shared .claude resources
    CLAUDE_DIR="$CURRENT/.claude"
    MAIN_CLAUDE="$MAIN_TREE/.claude"
    for shared in rules agents commands; do
        target="$CLAUDE_DIR/$shared"
        source="$MAIN_CLAUDE/$shared"
        if [ ! -e "$target" ] && [ -e "$source" ]; then
            if [ "$(uname -o 2>/dev/null)" = "Msys" ] || [ -n "$LOCALAPPDATA" ]; then
                cmd //c "mklink /J \"$(cygpath -w "$target")\" \"$(cygpath -w "$source")\"" > /dev/null 2>&1 || true
            else
                ln -s "$source" "$target" 2>/dev/null || true
            fi
            echo "  Linked .claude/$shared"
        fi
    done

    # Copy settings.json if missing (junctions don't work for files)
    if [ ! -f "$CLAUDE_DIR/settings.json" ] && [ -f "$MAIN_CLAUDE/settings.json" ]; then
        cp "$MAIN_CLAUDE/settings.json" "$CLAUDE_DIR/settings.json"
        echo "  Copied .claude/settings.json"
    fi
else
    echo "MAIN TREE: $BRANCH"
fi

# Read recent log
if [ ! -f "$LOG_FILE" ]; then
    echo "No prior runs."
    exit 0
fi

COUNT=5

tail -n "$COUNT" "$LOG_FILE" | $PYTHON -c "
import json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stdin.reconfigure(encoding='utf-8', errors='replace')
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        e = json.loads(line)
        ts = e.get('ts', '?')[:19]
        cmd = e.get('cmd', '?')
        summary = e.get('summary', '')
        bt = e.get('build_time_s')
        bt_s = f' ({bt}s)' if bt is not None else ''
        cited = e.get('cited', {})
        up = len(cited.get('up', []))
        cite_s = f' [cited: up={up}]' if up else ''
        print(f'[{ts}] /{cmd}{bt_s} {summary}{cite_s}')
    except json.JSONDecodeError:
        pass
"
