#!/bin/bash
# Stop hook: enforce prove.sh update was called after select
# Exit 0 = allow stop, Exit 2 = block stop (stderr continues agent)

INPUT=$(cat)
if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1

TRANSCRIPT=$(echo "$INPUT" | $PYTHON -c "import sys,json; print(json.load(sys.stdin).get('transcript_path',''))" 2>/dev/null)

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
    exit 0
fi

# If prove.sh select was called, update must also be called
if grep -q 'prove\.sh.*select' "$TRANSCRIPT" 2>/dev/null; then
    if ! grep -q 'prove\.sh.*update' "$TRANSCRIPT" 2>/dev/null; then
        echo "prove.sh select was called but update was not." >&2
        echo "Run prove.sh update with outcomes for each file before finishing." >&2
        echo "Example: bash .proofs/bin/prove.sh update .claude/rules/tab-bar.md TB-01:confirmed TB-02:updated" >&2
        exit 2
    fi
fi

exit 0
