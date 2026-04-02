#!/bin/bash
# prepare-review.sh — Build objective review brief from agent's description + git diff
# Reads review_brief_fields and review_agents from .proofs/config.json
# Usage: prepare-review.sh --intent "..." --approach "..." [--limitations "..."] [--alternatives "..."]
set -euo pipefail

PROOFS_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")/.proofs"
CONFIG="$PROOFS_DIR/config.json"
if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1

$PYTHON - "$@" << 'PYEOF'
import json, sys, os, subprocess, re

proofs_dir = os.environ.get('PROOFS_DIR', '.proofs')
config_path = os.path.join(proofs_dir, 'config.json')

# Load config
try:
    with open(config_path) as f:
        config = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    config = {
        'review_brief_fields': [
            {'flag': 'intent', 'label': 'Intent', 'required': True},
            {'flag': 'approach', 'label': 'Approach', 'required': True}
        ],
        'review_agents': [
            {'name': 'reviewer', 'prompt_suffix': 'Review these changes for correctness, simplification opportunities, and test coverage.'}
        ]
    }

fields = config.get('review_brief_fields', [])
agents = config.get('review_agents', [])

# Parse args
args = sys.argv[1:]
values = {}
i = 0
while i < len(args):
    if args[i].startswith('--') and i + 1 < len(args):
        key = args[i][2:]
        values[key] = args[i + 1]
        i += 2
    else:
        print(f'ERROR: Unknown argument: {args[i]}', file=sys.stderr)
        flags = ' '.join(f'--{f["flag"]} "..."' for f in fields)
        print(f'Usage: prepare-review.sh {flags}', file=sys.stderr)
        sys.exit(1)

# Validate required fields
errors = []
for field in fields:
    if field.get('required') and field['flag'] not in values:
        errors.append(f'--{field["flag"]} is required: {field["label"]}')

if errors:
    print('ERRORS:', file=sys.stderr)
    for e in errors:
        print(f'  - {e}', file=sys.stderr)
    sys.exit(1)

# Get git diff
try:
    stat = subprocess.run(['git', 'diff', 'HEAD', '--stat'], capture_output=True, encoding='utf-8', errors='replace').stdout.strip()
    diff = subprocess.run(['git', 'diff', 'HEAD'], capture_output=True, encoding='utf-8', errors='replace').stdout
except:
    stat = '(no git diff available)'
    diff = ''

# Build the brief
brief = '## Review Brief\n\n'
for field in fields:
    if field['flag'] in values:
        brief += f'### {field["label"]}\n{values[field["flag"]]}\n\n'

brief += f'### Changed Files\n{stat}\n\n'
brief += f'### Diff\n```\n{diff}\n```\n'

# Output brief
print(brief)

# Output agent list
print('\n## Agents to Spawn')
for agent in agents:
    name = agent if isinstance(agent, str) else agent.get('name', '')
    suffix = '' if isinstance(agent, str) else agent.get('prompt_suffix', '')
    print(f'  {name}: {suffix}')
PYEOF
