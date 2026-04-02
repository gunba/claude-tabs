#!/bin/bash
# Stop hook: enforce ## Cited section in agent output
# Exit 0 = allow stop, Exit 2 = block stop (stderr continues agent)

INPUT=$(cat)
if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1

TRANSCRIPT=$(echo "$INPUT" | $PYTHON -c "import sys,json; print(json.load(sys.stdin).get('transcript_path',''))" 2>/dev/null)

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
    exit 0
fi

if grep -q '## Cited' "$TRANSCRIPT" 2>/dev/null; then
    exit 0
fi

echo "Include a ## Cited section before finishing." >&2
echo "Format:" >&2
echo "## Cited" >&2
echo "Up: [XX-NN] [XX-NN]" >&2
echo "Down: [XX-NN] reason" >&2
exit 2
