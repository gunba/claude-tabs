#!/bin/bash
# tag-add.sh — Add a tagged entry to a doc/rule file
# Usage: tag-add.sh --doc DOCFILE --section "Section Name" --text "Entry text" --files "file,..." [--code XX]
# Note: --files takes file paths only, no line numbers (they shift on every edit)
# Auto-assigns next tag number. --code required only for new sections.

set -euo pipefail

if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1
PROOFS_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")/.proofs"
mkdir -p "$PROOFS_DIR"

export PROOFS_DIR

$PYTHON - "$@" << 'PYEOF'
import json, sys, os, re

args = sys.argv[1:]
doc_file = None
section = None
text = None
files_raw = None
code = None

i = 0
while i < len(args):
    if args[i] == '--doc' and i + 1 < len(args):
        doc_file = args[i + 1]; i += 2
    elif args[i] == '--section' and i + 1 < len(args):
        section = args[i + 1]; i += 2
    elif args[i] == '--text' and i + 1 < len(args):
        text = args[i + 1]; i += 2
    elif args[i] == '--files' and i + 1 < len(args):
        files_raw = args[i + 1]; i += 2
    elif args[i] == '--code' and i + 1 < len(args):
        code = args[i + 1].upper(); i += 2
    else:
        print(f'ERROR: Unknown argument: {args[i]}', file=sys.stderr)
        print('Usage: tag-add.sh --doc FILE --section "Name" --text "Entry" --files "f:n,..." [--code XX]', file=sys.stderr)
        sys.exit(1)

errors = []
if not doc_file: errors.append('--doc is required (e.g. .claude/rules/some-rule.md)')
if not section: errors.append('--section is required (e.g. "Tab Bar")')
if not text: errors.append('--text is required')
if not files_raw: errors.append('--files is required (e.g. "src/App.tsx")')
if code and not re.match(r'^[A-Z]{2}$', code):
    errors.append(f'--code must be exactly 2 uppercase letters (got: "{code}")')

if errors:
    print('ERRORS:', file=sys.stderr)
    for e in errors: print(f'  - {e}', file=sys.stderr)
    sys.exit(1)

# Read doc file
try:
    with open(doc_file, 'r', encoding='utf-8') as f:
        content = f.read()
        lines = content.split('\n')
except FileNotFoundError:
    print(f'ERROR: {doc_file} does not exist. Run scaffolding first.', file=sys.stderr)
    sys.exit(1)

# Find all existing codes from comment block
existing_codes = {}
code_comment = re.search(r'<!-- Codes: (.+?) -->', content)
if code_comment:
    for pair in code_comment.group(1).split(','):
        pair = pair.strip()
        if '=' in pair:
            c, name = pair.split('=', 1)
            existing_codes[c.strip()] = name.strip()

# Skip YAML frontmatter if present
body_start = 0
if lines and lines[0].strip() == '---':
    for fi in range(1, len(lines)):
        if lines[fi].strip() == '---':
            body_start = fi + 1
            break

# Find the section (exact match first, then case-insensitive substring)
# Match both H1 (# Title) and H2 (## Title) headers
section_line = None
section_end = None
section_code = None

all_sections = {}
for idx, line in enumerate(lines):
    if idx >= body_start and re.match(r'^#{1,2} ', line):
        all_sections[line.lstrip('# ').rstrip()] = idx

match_name = None
if section in all_sections:
    match_name = section
else:
    candidates = [s for s in all_sections if section.lower() in s.lower()]
    if len(candidates) == 1:
        match_name = candidates[0]
    elif len(candidates) > 1:
        print(f'ERROR: "{section}" is ambiguous. Matches: {", ".join(candidates)}', file=sys.stderr)
        sys.exit(1)

if match_name:
    section_line = all_sections[match_name]
    section = match_name
    for j in range(section_line + 1, len(lines)):
        if re.match(r'^#{1,2} ', lines[j]):
            section_end = j
            break
        tag_match = re.match(r'^- \[([A-Z]{2})-\d{2,3}\]', lines[j])
        if tag_match:
            section_code = tag_match.group(1)
    if section_end is None:
        section_end = len(lines)
# Section doesn't exist — need --code
if section_line is None:
    if not code:
        print(f'ERROR: Section "{section}" not found. Use --code XX to create it.', file=sys.stderr)
        print(f'Existing sections: {", ".join(existing_codes.values()) if existing_codes else "none"}', file=sys.stderr)
        sys.exit(1)
    if code in existing_codes:
        print(f'ERROR: Code "{code}" already used for "{existing_codes[code]}".', file=sys.stderr)
        sys.exit(1)
    section_code = code
    # Update codes comment in content first
    if code_comment:
        old_comment = code_comment.group(0)
        new_codes = code_comment.group(1) + f', {code}={section}'
        content = content.replace(old_comment, f'<!-- Codes: {new_codes} -->')
    # Append new section header to content, then rebuild lines
    # Detect heading level from existing sections, default to H2
    heading_prefix = '##'
    for idx2, line2 in enumerate(lines):
        if idx2 >= body_start and re.match(r'^#{1,2} ', line2):
            heading_prefix = '#' if line2.startswith('# ') and not line2.startswith('## ') else '##'
            break
    content = content.rstrip() + f'\n\n{heading_prefix} {section}\n\n'
    lines = content.split('\n')
    # Find the section we just added
    for idx, line in enumerate(lines):
        if re.match(r'^#{1,2} ', line) and line.lstrip('# ').rstrip() == section:
            section_line = idx
            section_end = len(lines)
            break

if not section_code:
    section_code = code
if not section_code:
    print(f'ERROR: Could not determine section code. Use --code XX.', file=sys.stderr)
    sys.exit(1)

# Find next tag number
existing_nums = []
for line in lines[section_line:section_end]:
    m = re.match(rf'^- \[{section_code}-(\d{{2,3}})\]', line)
    if m:
        existing_nums.append(int(m.group(1)))

next_num = max(existing_nums) + 1 if existing_nums else 1
tag = f'{section_code}-{next_num:02d}'

# Build the entry line
# Strip any line numbers from --files (enforce no-line-number rule)
file_list = [re.sub(r':\d+$', '', f.strip()) for f in files_raw.split(',') if f.strip()]
entry_line = f'- [{tag}] {text}'
sub_lines = [f'  - Files: {", ".join(file_list)}']

# Insert before section_end (or after last entry in section)
insert_at = section_end
for idx in range(section_end - 1, section_line, -1):
    if lines[idx].strip():
        insert_at = idx + 1
        break

for sub in reversed(sub_lines):
    lines.insert(insert_at, sub)
lines.insert(insert_at, entry_line)

# Write back
with open(doc_file, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

# Also update tag metadata in prove state
proofs_dir = os.environ.get('PROOFS_DIR', '.proofs')
base = os.path.basename(doc_file).replace('.md', '').lower()
state_path = os.path.join(proofs_dir, f'prove-{base}.json')
try:
    with open(state_path, 'r') as f:
        state = json.load(f)
    if tag not in state['all_tags']:
        state['all_tags'].append(tag)
        state['all_tags'].sort()
    if tag not in state.get('unchecked', []):
        state['unchecked'].append(tag)
        state['unchecked'].sort()
    state.setdefault('citations', {})[tag] = {'up': 0, 'down': 0}
    state.setdefault('metadata', {})[tag] = {
        'files': file_list,
        'verified': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).strftime('%Y-%m-%d'),
        'notes': 'Added during change documentation'
    }
    with open(state_path, 'w') as f:
        json.dump(state, f, indent=2)
except (FileNotFoundError, json.JSONDecodeError):
    pass  # No prove state yet, that's fine

print(f'Added [{tag}] to {doc_file} > {section}')
print(f'Text: {text}')
print(f'Files: {", ".join(file_list)}')
PYEOF
