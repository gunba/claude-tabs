#!/bin/bash
# tag-edit.sh — Edit or remove an existing tagged entry in a doc/rule file
# Usage: tag-edit.sh --tag TAG --text "new text" [--files "file,..."] [--reset-citations]
#        tag-edit.sh --tag TAG --remove
# Note: --files takes file paths only, no line numbers (they shift on every edit)
# Citations are preserved by default. Pass --reset-citations to zero them out.
# Validates tag exists. Updates doc file and prove metadata.

set -euo pipefail

export PROOFS_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")/.proofs"

if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1

$PYTHON - "$@" << 'PYEOF'
import json, sys, os, re
from datetime import datetime, timezone

proofs_dir = os.environ['PROOFS_DIR']
# Read doc files from config
_config_path = os.path.join(proofs_dir, 'config.json')
try:
    with open(_config_path) as _cf:
        _config = json.load(_cf)
    DOC_FILES = _config.get('docs', ['CLAUDE.md'])
except:
    DOC_FILES = ['CLAUDE.md']

args = sys.argv[1:]
tag = None
new_text = None
files_raw = None
remove = False
reset_citations = False

i = 0
while i < len(args):
    if args[i] == '--tag' and i + 1 < len(args):
        tag = args[i + 1].upper().strip(); i += 2
    elif args[i] == '--text' and i + 1 < len(args):
        new_text = args[i + 1]; i += 2
    elif args[i] == '--files' and i + 1 < len(args):
        files_raw = args[i + 1]; i += 2
    elif args[i] == '--remove':
        remove = True; i += 1
    elif args[i] == '--reset-citations':
        reset_citations = True; i += 1
    else:
        print(f'ERROR: Unknown argument: {args[i]}', file=sys.stderr)
        print('Usage: tag-edit.sh --tag TAG --text "new text" [--files "file,..."] [--reset-citations]', file=sys.stderr)
        print('       tag-edit.sh --tag TAG --remove', file=sys.stderr)
        sys.exit(1)

errors = []
if not tag:
    errors.append('--tag is required')
elif not re.match(r'^[A-Z]{2}-\d{2,3}$', tag):
    errors.append(f'--tag "{tag}" has invalid format (expected XX-NN)')
if not remove and not new_text:
    errors.append('--text is required (or use --remove to delete the entry)')
if errors:
    print('ERRORS:', file=sys.stderr)
    for e in errors: print(f'  - {e}', file=sys.stderr)
    sys.exit(1)

# Find which doc file contains this tag
target_file = None
tag_line = None
tag_end = None

for filepath in DOC_FILES:
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except FileNotFoundError:
        continue

    for idx, line in enumerate(lines):
        if re.match(rf'^- \[{re.escape(tag)}\]', line):
            target_file = filepath
            tag_line = idx
            # Find end of entry (next top-level bullet or section or EOF)
            tag_end = idx + 1
            while tag_end < len(lines) and lines[tag_end].startswith('  '):
                tag_end += 1
            break
    if target_file:
        break

if not target_file:
    print(f'ERROR: Tag "{tag}" not found in {", ".join(DOC_FILES)}', file=sys.stderr)
    sys.exit(1)

with open(target_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

if remove:
    # Delete the entry and its sub-bullets
    del lines[tag_line:tag_end]
    with open(target_file, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    # Update prove state
    base = os.path.basename(target_file).replace('.md', '').lower()
    state_path = os.path.join(proofs_dir, f'prove-{base}.json')
    try:
        with open(state_path, 'r') as f:
            state = json.load(f)
        if tag in state.get('all_tags', []):
            state['all_tags'].remove(tag)
        if tag in state.get('unchecked', []):
            state['unchecked'].remove(tag)
        state.get('citations', {}).pop(tag, None)
        state.get('metadata', {}).pop(tag, None)
        with open(state_path, 'w') as f:
            json.dump(state, f, indent=2)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    print(f'Removed [{tag}] from {target_file} ({tag_end - tag_line} lines deleted)')
else:
    # Strip line numbers from --files (enforce no-line-number rule)
    file_list = [re.sub(r':\d+$', '', f.strip()) for f in files_raw.split(',') if f.strip()] if files_raw else None
    new_lines = [f'- [{tag}] {new_text}\n']
    if file_list:
        new_lines.append(f'  - Files: {", ".join(file_list)}\n')
    lines[tag_line:tag_end] = new_lines
    with open(target_file, 'w', encoding='utf-8') as f:
        f.writelines(lines)

    # Update prove state
    base = os.path.basename(target_file).replace('.md', '').lower()
    state_path = os.path.join(proofs_dir, f'prove-{base}.json')
    try:
        with open(state_path, 'r') as f:
            state = json.load(f)

        # Only reset citations if explicitly requested
        if reset_citations:
            state.setdefault('citations', {})[tag] = {'up': 0, 'down': 0}
            print('Citations reset.')

        # Update metadata — append edit note, preserve existing notes
        existing = state.setdefault('metadata', {}).get(tag, {})
        existing_notes = existing.get('notes', [])
        if isinstance(existing_notes, str):
            existing_notes = [{'date': existing.get('verified', ''), 'text': existing_notes}] if existing_notes else []
        existing_notes.append({'date': today, 'text': 'Edited via tag-edit.sh'})

        state['metadata'][tag] = {
            'files': file_list or existing.get('files', []),
            'verified': today,
            'notes': existing_notes,
        }

        with open(state_path, 'w') as f:
            json.dump(state, f, indent=2)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    print(f'Edited [{tag}] in {target_file}')
    print(f'Text: {new_text}')
    if file_list:
        print(f'Files: {", ".join(file_list)}')
PYEOF
