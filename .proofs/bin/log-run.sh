#!/bin/bash
# log-run.sh — Log a command run with strict input validation
# Usage: log-run.sh --cmd CMD --summary SUMMARY [--build-time SECONDS] [--cited-up TAG,TAG] [--cited-down TAG:REASON ...]
# Errors on: invalid cmd, empty summary, non-numeric build time, tags not found in doc files

set -euo pipefail

export PROOFS_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")/.proofs"
export LOG_FILE="$PROOFS_DIR/runs.jsonl"

if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1
mkdir -p "$PROOFS_DIR"

$PYTHON - "$@" << 'PYEOF'
import json, sys, os, re
from datetime import datetime, timezone

proofs_dir = os.environ['PROOFS_DIR']
log_file = os.environ['LOG_FILE']
# Parse args
args = sys.argv[1:]
cmd = None
summary = None
build_time_raw = None
cited_up_raw = None
# cited_down removed - upvotes vs seen is sufficient

i = 0
while i < len(args):
    if args[i] == '--cmd' and i + 1 < len(args):
        cmd = args[i + 1]; i += 2
    elif args[i] == '--summary' and i + 1 < len(args):
        summary = args[i + 1]; i += 2
    elif args[i] == '--build-time' and i + 1 < len(args):
        build_time_raw = args[i + 1]; i += 2
    elif args[i] == '--cited-up' and i + 1 < len(args):
        cited_up_raw = args[i + 1]; i += 2

    else:
        print(f'ERROR: Unknown argument: {args[i]}', file=sys.stderr)
        print('Usage: log-run.sh --cmd CMD --summary SUMMARY [--build-time SECONDS] [--cited-up TAG,TAG] [--cited-down TAG:REASON ...]', file=sys.stderr)
        sys.exit(1)

errors = []

# Validate --cmd
valid_cmds = {'r', 'j', 'q', 'b'}
if cmd is None:
    errors.append('--cmd is required (one of: b, j, q, r)')
elif cmd not in valid_cmds:
    errors.append(f'--cmd must be one of: b, j, q, r (got: "{cmd}")')

# Validate --summary
if summary is None:
    errors.append('--summary is required')
elif len(summary.strip()) == 0:
    errors.append('--summary must be non-empty')

# Validate --build-time
build_time = None
if build_time_raw is not None:
    if build_time_raw.lower() == 'null' or build_time_raw == '':
        build_time = None
    else:
        try:
            build_time = float(build_time_raw)
            if build_time < 0:
                errors.append(f'--build-time must be non-negative (got: {build_time})')
        except ValueError:
            errors.append(f'--build-time must be a number or omitted (got: "{build_time_raw}")')

# Collect all valid tags from doc files
# Read docs from config (module scope - used by get_all_tags and prove state update)
import glob as _glob
_config_path = os.path.join(proofs_dir, 'config.json')
try:
    with open(_config_path) as _cf:
        _config = json.load(_cf)
except:
    _config = {}
_root = os.popen('git rev-parse --show-toplevel 2>/dev/null').read().strip() or '.'
_doc_list = []
for _rd in _config.get('rule_dirs', ['.claude/rules']):
    _dir = os.path.join(_root, _rd)
    _doc_list.extend(sorted(_glob.glob(os.path.join(_dir, '*.md'))))
_doc_list.extend(_config.get('docs', []))

def get_all_tags():
    tags = set()
    for f in _doc_list:
        try:
            with open(f, 'r', encoding='utf-8') as fh:
                tags.update(re.findall(r'\[([A-Z]{2}-\d{2,3})\]', fh.read()))
        except FileNotFoundError:
            pass
    return tags

all_tags = get_all_tags()
tag_pattern = re.compile(r'^[A-Z]{2}-\d{2,3}$')

# Validate --cited-up
cited_up = []
if cited_up_raw and cited_up_raw.strip():
    for tag in cited_up_raw.split(','):
        tag = tag.strip()
        if not tag:
            continue
        if not tag_pattern.match(tag):
            errors.append(f'--cited-up tag "{tag}" has invalid format (expected XX-NN, e.g. TB-01)')
        elif all_tags and tag not in all_tags:
            errors.append(f'--cited-up tag "{tag}" not found in any configured doc file')
        else:
            cited_up.append(tag)

cited_down = []

# Bail on errors
if errors:
    print('ERRORS:', file=sys.stderr)
    for e in errors:
        print(f'  - {e}', file=sys.stderr)
    sys.exit(1)

# Build and write entry
entry = {
    'ts': datetime.now(timezone.utc).isoformat(),
    'cmd': cmd,
    'summary': summary.strip(),
    'build_time_s': build_time,
    'cited': {'up': cited_up, 'down': cited_down}
}

with open(log_file, 'a', encoding='utf-8') as f:
    f.write(json.dumps(entry) + '\n')

# Auto-prune
max_entries = 50

try:
    with open(log_file, 'r') as f:
        lines = f.readlines()
    if len(lines) > max_entries:
        with open(log_file, 'w') as f:
            f.writelines(lines[-max_entries:])
except:
    pass

# Update prove state: increment seen counts for all tags, citation counts for cited tags
proofs_dir = os.environ.get('PROOFS_DIR', '.proofs')
for state_name in ['prove-' + os.path.basename(d).replace('.md', '').lower() + '.json' for d in _doc_list]:
    state_path = os.path.join(proofs_dir, state_name)
    try:
        with open(state_path, 'r') as sf:
            state = json.load(sf)
        changed = False
        # Increment seen count for all tags (they existed during this run)
        for tag in state.get('citations', {}):
            if 'seen' not in state['citations'][tag]:
                state['citations'][tag]['seen'] = 0
            state['citations'][tag]['seen'] += 1
            changed = True
        for tag in cited_up:
            if tag in state.get('citations', {}):
                state['citations'][tag]['up'] = state['citations'][tag].get('up', 0) + 1
                changed = True

        if changed:
            with open(state_path, 'w') as sf:
                json.dump(state, sf, indent=2)
    except (FileNotFoundError, json.JSONDecodeError):
        pass

# Output
print(f'Logged: [{entry["ts"][:19]}] /{cmd} "{summary.strip()}"')
if build_time is not None:
    print(f'Build: {build_time}s')
if cited_up:
    print(f'Cited up ({len(cited_up)}): {", ".join(cited_up)}')

PYEOF

