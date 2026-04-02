#!/bin/bash
# prove.sh — Prove selection and update for tagged documentation entries
# Usage:
#   prove.sh select <file>                    — Select batch of tags to prove
#   prove.sh select-all <file>                — Select ALL tags to prove
#   prove.sh select-matching <files...>       — Find rule files matching changed files, list them
#   prove.sh update <file> TAG:OUTCOME ...    — Record outcomes

set -euo pipefail

PROOFS_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")/.proofs"

if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1
if [ -z "$PYTHON" ]; then
    echo "Error: python required" >&2
    exit 1
fi

MAX_BATCH=$($PYTHON -c "
import json, os
proj = os.path.join(os.popen('git rev-parse --show-toplevel 2>/dev/null').read().strip() or '.', '.proofs', 'config.json')
try:
    with open(proj) as f:
        print(json.load(f).get('batch_size', 12))
except:
    print(12)
" 2>/dev/null || echo 12)

cmd_select() {
    local file="$1"
    local base
    base=$(basename "$file" .md | tr '[:upper:]' '[:lower:]')
    local sf="$PROOFS_DIR/prove-${base}.json"
    mkdir -p "$PROOFS_DIR"

    $PYTHON -c "
import json, os, random, re, sys, io
from datetime import datetime, timezone
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

file_path = sys.argv[1]
state_path = sys.argv[2]
max_batch = int(sys.argv[3])

# Extract all tags from file
try:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
except FileNotFoundError:
    print(f'Skipped: {file_path} does not exist.')
    sys.exit(0)

current_tags = sorted(set(re.findall(r'\[([A-Z]{2}-\d{2,3})\]', content)))

if not current_tags:
    print(f'Skipped: no tagged entries in {file_path}.')
    sys.exit(0)

# Dynamic batch size: 20% of tags rounded up, capped at max_batch
import math
batch_size = min(max_batch, max(3, math.ceil(len(current_tags) * 0.2)))

# Load or create state
try:
    with open(state_path, 'r') as f:
        state = json.load(f)
except:
    state = {
        'file': file_path,
        'all_tags': [],
        'unchecked': [],
        'citations': {},
        'cycle': 1,
        'last_run': None
    }

# Sync: add new tags, remove deleted
old_set = set(state['all_tags'])
current_set = set(current_tags)
added = current_set - old_set
removed = old_set - current_set

state['all_tags'] = sorted(current_set)
state['unchecked'] = sorted((set(state['unchecked']) | added) - removed)

# Remove deleted from citations
for tag in removed:
    state['citations'].pop(tag, None)

# Ensure all current tags have citation entries
for tag in current_tags:
    if tag not in state['citations']:
        state['citations'][tag] = {'up': 0, 'down': 0}

# Find downvoted entries to prioritize
downvoted = [t for t in state['unchecked']
             if state['citations'].get(t, {}).get('down', 0) > 0]

# Selection algorithm
unchecked = state['unchecked']
if len(unchecked) >= batch_size:
    priority = list(downvoted)
    rest = [t for t in unchecked if t not in downvoted]
    random.shuffle(priority)
    random.shuffle(rest)
    selected = (priority + rest)[:batch_size]
elif len(unchecked) > 0:
    selected = list(unchecked)
    remaining_needed = batch_size - len(selected)
    overlap_pool = [t for t in state['all_tags'] if t not in selected]
    random.shuffle(overlap_pool)
    selected += overlap_pool[:remaining_needed]
else:
    state['unchecked'] = list(state['all_tags'])
    state['cycle'] += 1
    unchecked = state['unchecked']
    priority = [t for t in downvoted if t in unchecked]
    rest = [t for t in unchecked if t not in priority]
    random.shuffle(priority)
    random.shuffle(rest)
    selected = (priority + rest)[:batch_size]

remaining_after = max(0, len(state['unchecked']) - len(selected))
state['last_run'] = datetime.now(timezone.utc).isoformat()

# Save state
with open(state_path, 'w') as f:
    json.dump(state, f, indent=2)

# Output
print(f'Cycle {state[\"cycle\"]}, batch. {len(selected)} selected, {remaining_after} remaining after this batch.')
print(f'Total entries: {len(state[\"all_tags\"])}')
print('Tags: ' + ' '.join(sorted(selected)))

# Output full entry text for each selected tag so prover doesn't need to read the file
print('')
print('--- ENTRIES ---')
content_lines = content.split(chr(10))
for tag in sorted(selected):
    for li, line in enumerate(content_lines):
        if re.match(r'^- \[' + re.escape(tag) + r'\]', line):
            entry_text = line.rstrip()
            for sli in range(li+1, len(content_lines)):
                if content_lines[sli].startswith('  '):
                    entry_text += chr(10) + content_lines[sli].rstrip()
                else:
                    break
            print(f'[{tag}] {entry_text}')
            print('')
            break
            print(f'[{tag}] {entry_text}')
            print('')
            break
" "$file" "$sf" "$MAX_BATCH"
}

cmd_select_all() {
    local file="$1"
    local base
    base=$(basename "$file" .md | tr '[:upper:]' '[:lower:]')
    local sf="$PROOFS_DIR/prove-${base}.json"
    mkdir -p "$PROOFS_DIR"

    $PYTHON -c "
import json, os, re, sys, io
from datetime import datetime, timezone
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

file_path = sys.argv[1]
state_path = sys.argv[2]

# Extract all tags from file
try:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
except FileNotFoundError:
    print(f'Skipped: {file_path} does not exist.')
    sys.exit(0)

current_tags = sorted(set(re.findall(r'\[([A-Z]{2}-\d{2,3})\]', content)))

if not current_tags:
    print(f'Skipped: no tagged entries in {file_path}.')
    sys.exit(0)

selected = current_tags

# Load or create state
try:
    with open(state_path, 'r') as f:
        state = json.load(f)
except:
    state = {
        'file': file_path,
        'all_tags': [],
        'unchecked': [],
        'citations': {},
        'cycle': 1,
        'last_run': None
    }

# Sync state
current_set = set(current_tags)
removed = set(state['all_tags']) - current_set
state['all_tags'] = sorted(current_set)
state['unchecked'] = []  # All will be checked
for tag in removed:
    state['citations'].pop(tag, None)
for tag in current_tags:
    if tag not in state['citations']:
        state['citations'][tag] = {'up': 0, 'down': 0}

state['cycle'] += 1
state['last_run'] = datetime.now(timezone.utc).isoformat()

with open(state_path, 'w') as f:
    json.dump(state, f, indent=2)

# Output
print(f'Full prove pass. {len(selected)} entries selected.')
print(f'Total entries: {len(state[\"all_tags\"])}')
print('Tags: ' + ' '.join(sorted(selected)))

# Output full entry text
print('')
print('--- ENTRIES ---')
content_lines = content.split(chr(10))
for tag in sorted(selected):
    for li, line in enumerate(content_lines):
        if re.match(r'^- \[' + re.escape(tag) + r'\]', line):
            entry_text = line.rstrip()
            for sli in range(li+1, len(content_lines)):
                if content_lines[sli].startswith('  '):
                    entry_text += chr(10) + content_lines[sli].rstrip()
                else:
                    break
            print(f'[{tag}] {entry_text}')
            print('')
            break
" "$file" "$sf"
}

cmd_update() {
    local file="$1"
    shift
    local base
    base=$(basename "$file" .md | tr '[:upper:]' '[:lower:]')
    local sf="$PROOFS_DIR/prove-${base}.json"

    if [ ! -f "$sf" ]; then
        echo "No state file found. Run 'prove.sh select' first." >&2
        exit 1
    fi

    $PYTHON -c "
import json, sys, re
from datetime import datetime, timezone

state_path = sys.argv[1]
outcomes = sys.argv[2:]

valid_outcomes = {'confirmed', 'updated', 'removed', 'flagged'}

with open(state_path, 'r') as f:
    state = json.load(f)

errors = []
valid_entries = []

for entry in outcomes:
    parts = entry.split(':', 1)
    if len(parts) != 2:
        errors.append(f'Malformed entry \"{entry}\" — must be TAG:OUTCOME (e.g. TB-01:confirmed)')
        continue
    tag, outcome = parts[0].strip(), parts[1].strip()

    if not re.match(r'^[A-Z]{2}-\d{2,3}$', tag):
        errors.append(f'Tag \"{tag}\" has invalid format (expected XX-NN, e.g. TB-01)')
        continue

    if outcome not in valid_outcomes:
        errors.append(f'Outcome \"{outcome}\" for tag {tag} is invalid — must be one of: {', '.join(sorted(valid_outcomes))}')
        continue

    if tag not in state['all_tags']:
        errors.append(f'Tag \"{tag}\" not found in state. Known tags: {', '.join(state['all_tags'][:10])}{'...' if len(state['all_tags']) > 10 else ''}')
        continue

    valid_entries.append((tag, outcome))

if errors:
    print('ERRORS:', file=sys.stderr)
    for e in errors:
        print(f'  - {e}', file=sys.stderr)
    sys.exit(1)

for tag, outcome in valid_entries:
    if tag in state['unchecked']:
        state['unchecked'].remove(tag)

    if outcome == 'removed':
        if tag in state['all_tags']:
            state['all_tags'].remove(tag)
        state['citations'].pop(tag, None)
    elif outcome == 'updated':
        state['citations'][tag] = {'up': 0, 'down': 0}

state['last_run'] = datetime.now(timezone.utc).isoformat()

with open(state_path, 'w') as f:
    json.dump(state, f, indent=2)

print(f'Updated {len(valid_entries)} entries. {len(state[\"unchecked\"])} unchecked remaining in cycle {state[\"cycle\"]}.')
for tag, outcome in valid_entries:
    print(f'  {tag}: {outcome}')
" "$sf" "$@"
}

cmd_select_matching() {
    # Given changed files, find matching rule files, select MAX_BATCH tags total
    # across all matching + global files. Outputs entry text ready for prover.
    local changed_files="$@"

    $PYTHON -c "
import json, math, os, random, re, sys, io, fnmatch
from datetime import datetime, timezone
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

proofs_dir = os.environ.get('PROOFS_DIR', '.proofs')
config_path = os.path.join(proofs_dir, 'config.json')
max_batch = int(sys.argv[1])
changed = sys.argv[2:]

try:
    with open(config_path) as f:
        config = json.load(f)
except:
    print('ERROR: Cannot read .proofs/config.json', file=sys.stderr)
    sys.exit(1)

if not changed:
    print('No changed files provided.', file=sys.stderr)
    sys.exit(1)

import glob as _glob
_root = os.popen('git rev-parse --show-toplevel 2>/dev/null').read().strip() or '.'
docs = []
for _rd in config.get('rule_dirs', ['.claude/rules']):
    _dir = os.path.join(_root, _rd)
    docs.extend(sorted(_glob.glob(os.path.join(_dir, '*.md'))))
docs.extend(config.get('docs', []))

def parse_paths_frontmatter(content):
    if not content.startswith('---'):
        return None
    end = content.find('---', 3)
    if end == -1:
        return None
    fm_lines = content[3:end].strip().split(chr(10))
    paths = []
    in_paths = False
    for line in fm_lines:
        stripped = line.strip()
        if stripped.startswith('paths:'):
            in_paths = True
            continue
        if in_paths:
            if stripped.startswith('- '):
                val = stripped[2:].strip().strip('\"').strip(\"'\")
                if val:
                    paths.append(val)
            else:
                break
    return paths if paths else None

def file_matches(cf, patterns):
    for pattern in patterns:
        if fnmatch.fnmatch(cf, pattern):
            return True
        if '**' in pattern:
            base = pattern.split('**')[0].rstrip('/')
            if cf.startswith(base + '/') or cf == base:
                return True
    return False

def extract_tags(content):
    tags = []
    for line in content.split(chr(10)):
        m = re.match(r'^- \[([A-Z]{2}-\d{2,3})\]', line)
        if m:
            tags.append(m.group(1))
    return tags

def extract_entry(content, tag):
    lines = content.split(chr(10))
    for li, line in enumerate(lines):
        if re.match(r'^- \[' + re.escape(tag) + r'\]', line):
            entry = line.rstrip()
            for sli in range(li+1, len(lines)):
                if lines[sli].startswith('  '):
                    entry += chr(10) + lines[sli].rstrip()
                else:
                    break
            return entry
    return None

# Collect candidate tags from matching + global files
candidates = []  # (tag, doc_path, content)
file_contents = {}

for doc_path in docs:
    try:
        with open(doc_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        continue

    paths = parse_paths_frontmatter(content)
    is_global = paths is None
    is_match = is_global or any(file_matches(cf.replace(os.sep, '/'), paths) for cf in changed)

    if not is_match:
        continue

    file_contents[doc_path] = content
    tags = extract_tags(content)
    for tag in tags:
        candidates.append((tag, doc_path))

if not candidates:
    print('No matching tags found.')
    sys.exit(0)

# Load prove state to prioritize unchecked/downvoted tags
tag_priority = {}  # tag -> priority score (higher = more urgent)
for doc_path in file_contents:
    base = os.path.basename(doc_path).replace('.md', '').lower()
    state_path = os.path.join(proofs_dir, f'prove-{base}.json')
    try:
        with open(state_path) as f:
            state = json.load(f)
        unchecked = set(state.get('unchecked', []))
        citations = state.get('citations', {})
        for tag in state.get('all_tags', []):
            score = 0
            if tag in unchecked:
                score += 10
            if citations.get(tag, {}).get('down', 0) > 0:
                score += 20  # downvoted = highest priority
            tag_priority[tag] = score
    except:
        pass

# Sort candidates: downvoted first, then unchecked, then random
random.shuffle(candidates)
candidates.sort(key=lambda x: -tag_priority.get(x[0], 0))

# Select up to max_batch
selected = candidates[:max_batch]

# Group by file for prove.sh update later
by_file = {}
for tag, doc_path in selected:
    by_file.setdefault(doc_path, []).append(tag)

# Update prove state: mark selected as checked
now = datetime.now(timezone.utc).isoformat()
for doc_path, tags in by_file.items():
    base = os.path.basename(doc_path).replace('.md', '').lower()
    state_path = os.path.join(proofs_dir, f'prove-{base}.json')
    try:
        with open(state_path) as f:
            state = json.load(f)
    except:
        continue
    state['last_run'] = now
    with open(state_path, 'w') as f:
        json.dump(state, f, indent=2)

# Output
file_count = len(by_file)
print(f'Selected {len(selected)} tags from {file_count} files (max {max_batch}).')
print(f'Candidate pool: {len(candidates)} tags from {len(file_contents)} matching files.')
print()

for doc_path, tags in sorted(by_file.items()):
    print(f'FILE: {doc_path} ({len(tags)} tags)')
    for tag in sorted(tags):
        print(f'  {tag}')

print()
print('--- ENTRIES ---')
for tag, doc_path in selected:
    content = file_contents[doc_path]
    entry = extract_entry(content, tag)
    if entry:
        print(f'[{tag}] ({doc_path})')
        print(entry)
        print()
" "$MAX_BATCH" $changed_files
}

# Main
case "${1:-}" in
    select)
        [ -z "${2:-}" ] && echo "Usage: prove.sh select <file>" >&2 && exit 1
        cmd_select "$2"
        ;;
    select-all)
        [ -z "${2:-}" ] && echo "Usage: prove.sh select-all <file>" >&2 && exit 1
        cmd_select_all "$2"
        ;;
    select-matching)
        shift
        [ -z "${1:-}" ] && echo "Usage: prove.sh select-matching <file1> [file2] ..." >&2 && exit 1
        cmd_select_matching "$@"
        ;;
    update)
        [ -z "${2:-}" ] && echo "Usage: prove.sh update <file> TAG:OUTCOME ..." >&2 && exit 1
        file="$2"
        shift 2
        cmd_update "$file" "$@"
        ;;
    *)
        echo "Usage: prove.sh {select|update} <file> [args...]" >&2
        exit 1
        ;;
esac
