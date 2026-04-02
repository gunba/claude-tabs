#!/bin/bash
# tag-update.sh — Update per-tag metadata in prove state
# Usage: tag-update.sh --tag TAG --doc DOCFILE --files "file,file" [--notes "text"]
# Note: --files takes file paths only, no line numbers (they shift on every edit)
# Notes append to a list (not overwrite). Files list is replaced.
# Errors on: invalid tag format, tag not found in prove state, missing doc file

set -euo pipefail

export PROOFS_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")/.proofs"

if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1

$PYTHON - "$@" << 'PYEOF'
import json, sys, os, re
from datetime import datetime, timezone

proj_dir = os.environ['PROOFS_DIR']

args = sys.argv[1:]
tag = None
doc_file = None
files_raw = None
notes = None

i = 0
while i < len(args):
    if args[i] == '--tag' and i + 1 < len(args):
        tag = args[i + 1].upper().strip(); i += 2
    elif args[i] == '--doc' and i + 1 < len(args):
        doc_file = args[i + 1]; i += 2
    elif args[i] == '--files' and i + 1 < len(args):
        files_raw = args[i + 1]; i += 2
    elif args[i] == '--notes' and i + 1 < len(args):
        notes = args[i + 1]; i += 2
    else:
        print(f'ERROR: Unknown argument: {args[i]}', file=sys.stderr)
        print('Usage: tag-update.sh --tag TAG --doc DOCFILE --files "file,..." [--notes "text"]', file=sys.stderr)
        sys.exit(1)

errors = []

if not tag:
    errors.append('--tag is required (e.g. TB-01)')
elif not re.match(r'^[A-Z]{2}-\d{2,3}$', tag):
    errors.append(f'--tag "{tag}" has invalid format (expected XX-NN)')

if not doc_file:
    errors.append('--doc is required (e.g. .claude/rules/tab-bar.md)')

if not files_raw:
    errors.append('--files is required (e.g. "src/App.tsx,src/App.css")')

if errors:
    print('ERRORS:', file=sys.stderr)
    for e in errors:
        print(f'  - {e}', file=sys.stderr)
    sys.exit(1)

# Strip any line numbers from --files (enforce no-line-number rule)
file_list = [re.sub(r':\d+$', '', f.strip()) for f in files_raw.split(',') if f.strip()]

# Determine state file from doc file
base = os.path.basename(doc_file).replace('.md', '').lower()
state_path = os.path.join(proj_dir, f'prove-{base}.json')

# Load state
try:
    with open(state_path, 'r') as f:
        state = json.load(f)
except FileNotFoundError:
    print(f'ERROR: No prove state for {doc_file}. Run prove.sh select first.', file=sys.stderr)
    sys.exit(1)

if tag not in state.get('all_tags', []):
    print(f'ERROR: Tag "{tag}" not found in prove state for {doc_file}.', file=sys.stderr)
    similar = [t for t in state.get('all_tags', []) if t[:2] == tag[:2]]
    if similar:
        print(f'Tags in {tag[:2]} section: {", ".join(sorted(similar))}', file=sys.stderr)
    sys.exit(1)

today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

# Update metadata — preserve existing, append notes
if 'metadata' not in state:
    state['metadata'] = {}

existing = state['metadata'].get(tag, {})
existing_notes = existing.get('notes', [])

# Migrate legacy string notes to list
if isinstance(existing_notes, str):
    existing_notes = [{'date': existing.get('verified', ''), 'text': existing_notes}] if existing_notes else []

# Append new note if provided
if notes:
    existing_notes.append({'date': today, 'text': notes})

state['metadata'][tag] = {
    'files': file_list,
    'verified': today,
    'notes': existing_notes,
}

with open(state_path, 'w') as f:
    json.dump(state, f, indent=2)

print(f'Updated [{tag}]: {len(file_list)} implementing files recorded.')
if notes:
    print(f'Notes: {notes} (total: {len(existing_notes)} entries)')
PYEOF
