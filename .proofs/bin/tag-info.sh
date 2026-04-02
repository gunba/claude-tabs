#!/bin/bash
# tag-info.sh — Query tagged documentation entries
# Usage: tag-info.sh lookup TAG        — Show entry text, file, citations
#        tag-info.sh search TERM       — Find tags matching text
#        tag-info.sh list [PREFIX]     — List all tags or by section prefix
#        tag-info.sh stats             — Summary of tags, citations, coverage

set -euo pipefail

export PROOFS_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")/.proofs"

if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1

$PYTHON - "$@" << 'PYEOF'
import json, sys, os, re

proj_dir = os.environ['PROOFS_DIR']

# Read doc files from config
import glob as _glob
_config_path = os.path.join(proj_dir, 'config.json')
try:
    with open(_config_path) as _cf:
        _config = json.load(_cf)
except:
    _config = {}
_root = os.path.dirname(proj_dir)
DOC_FILES = []
for _rd in _config.get('rule_dirs', ['.claude/rules']):
    _dir = os.path.join(_root, _rd)
    DOC_FILES.extend(sorted(_glob.glob(os.path.join(_dir, '*.md'))))
DOC_FILES.extend(_config.get('docs', []))

def load_entries():
    """Parse all tagged entries from doc files."""
    entries = {}
    for filepath in DOC_FILES:
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        except FileNotFoundError:
            continue
        current_section = ''
        for i, line in enumerate(lines, 1):
            if re.match(r'^#{1,2} ', line):
                current_section = line.lstrip('# ').rstrip()
            match = re.match(r'^- \[([A-Z]{2}-\d{2,3})\]\s*(.*)', line)
            if match:
                tag, text = match.group(1), match.group(2).strip()
                # Collect sub-bullets
                full_text = text
                j = i
                while j < len(lines) and lines[j].startswith('  '):
                    full_text += '\n' + lines[j].rstrip()
                    j += 1
                entries[tag] = {
                    'tag': tag,
                    'text': full_text,
                    'file': filepath,
                    'line': i,
                    'section': current_section
                }
    return entries

def load_prove_data():
    """Load citation counts and metadata from prove state files."""
    citations = {}
    metadata = {}
    for name in ['prove-' + os.path.basename(d).replace('.md', '').lower() + '.json' for d in DOC_FILES]:
        path = os.path.join(proj_dir, name)
        try:
            with open(path) as f:
                state = json.load(f)
            for tag, counts in state.get('citations', {}).items():
                citations[tag] = counts
            for tag, meta in state.get('metadata', {}).items():
                metadata[tag] = meta
        except (FileNotFoundError, json.JSONDecodeError):
            pass
    return citations, metadata

def cmd_lookup(tag):
    tag = tag.upper().strip()
    if not re.match(r'^[A-Z]{2}-\d{2,3}$', tag):
        print(f'ERROR: Invalid tag format "{tag}" (expected XX-NN, e.g. TB-01)', file=sys.stderr)
        sys.exit(1)

    entries = load_entries()
    citations, metadata = load_prove_data()

    if tag not in entries:
        print(f'ERROR: Tag "{tag}" not found in {", ".join(DOC_FILES)}', file=sys.stderr)
        prefix = tag[:2]
        similar = [t for t in entries if t.startswith(prefix)]
        if similar:
            print(f'Tags in {prefix} section: {", ".join(sorted(similar))}', file=sys.stderr)
        sys.exit(1)

    e = entries[tag]
    c = citations.get(tag, {'up': 0, 'down': 0})
    m = metadata.get(tag, {})
    print(f'[{tag}] {e["file"]}:{e["line"]}')
    print(f'Section: {e["section"]}')
    seen = c.get('seen', 0)
    ratio = f' ({c["up"]}/{seen})' if seen > 0 else ''
    print(f'Citations: {c["up"]} up, {seen} seen{ratio}')
    if m.get('files'):
        print(f'Implementing: {", ".join(m["files"])}')
    if m.get('verified'):
        print(f'Last verified: {m["verified"]}')
    if m.get('notes'):
        print(f'Notes: {m["notes"]}')
    print(f'---')
    print(e['text'])

def cmd_search(term):
    term_lower = term.lower()
    entries = load_entries()
    citations, metadata = load_prove_data()
    matches = []

    for tag, e in entries.items():
        if term_lower in e['text'].lower() or term_lower in e['section'].lower():
            c = citations.get(tag, {'up': 0, 'down': 0})
            matches.append((tag, e, c))

    if not matches:
        print(f'No entries matching "{term}".')
        sys.exit(0)

    print(f'{len(matches)} entries matching "{term}":')
    for tag, e, c in sorted(matches, key=lambda x: x[0]):
        short = e['text'][:80].replace('\n', ' ')

def cmd_list(prefix=None):
    entries = load_entries()
    citations, metadata = load_prove_data()
    filtered = entries
    if prefix:
        prefix = prefix.upper()
        filtered = {t: e for t, e in entries.items() if t.startswith(prefix)}

    if not filtered:
        if prefix:
            print(f'No entries with prefix "{prefix}". Available prefixes: {", ".join(sorted(set(t[:2] for t in entries)))}')
        else:
            print('No tagged entries found.')
        sys.exit(0)

    # Group by section
    sections = {}
    for tag, e in sorted(filtered.items()):
        key = f'{e["file"]} > {e["section"]}'
        sections.setdefault(key, []).append((tag, e))

    total = len(filtered)
    print(f'{total} entries' + (f' with prefix {prefix}' if prefix else '') + ':')
    for section, items in sections.items():
        print(f'\n  {section}')
        for tag, e in items:
            c = citations.get(tag, {'up': 0, 'down': 0})
            short = e['text'][:60].replace('\n', ' ')
            cite = f' [up={c.get("up", 0)} seen={c.get("seen", 0)}]' if c.get('up', 0) or c.get('seen', 0) else ''
            print(f'    [{tag}] {short}{"..." if len(e["text"]) > 60 else ""}{cite}')

def cmd_stats():
    entries = load_entries()
    citations, metadata = load_prove_data()

    by_file = {}
    for tag, e in entries.items():
        by_file.setdefault(e['file'], []).append(tag)

    total_up = sum(c.get('up', 0) for c in citations.values())

    total_seen = sum(c.get('seen', 0) for c in citations.values())
    uncited = [t for t in entries if t not in citations or (citations[t]['up'] == 0 and True)]


    print(f'Total entries: {len(entries)}')
    for f, tags in sorted(by_file.items()):
        print(f'  {f}: {len(tags)} entries')
    ratio = f' ({total_up}/{total_seen} = {total_up*100//total_seen if total_seen else 0}%)' if total_seen else ''
    print(f'Citations: {total_up} up, {total_seen} seen{ratio}')
    print(f'Uncited entries: {len(uncited)}')

# Main
args = sys.argv[1:]
if not args:
    print('Usage: tag-info.sh {lookup TAG | search TERM | list [PREFIX] | stats}', file=sys.stderr)
    sys.exit(1)

cmd = args[0]
if cmd == 'lookup':
    if len(args) < 2:
        print('ERROR: lookup requires a tag (e.g. tag-info.sh lookup TB-01)', file=sys.stderr)
        sys.exit(1)
    cmd_lookup(args[1])
elif cmd == 'search':
    if len(args) < 2:
        print('ERROR: search requires a term (e.g. tag-info.sh search "session resume")', file=sys.stderr)
        sys.exit(1)
    cmd_search(' '.join(args[1:]))
elif cmd == 'list':
    cmd_list(args[1] if len(args) > 1 else None)
elif cmd == 'stats':
    cmd_stats()
else:
    print(f'ERROR: Unknown command "{cmd}". Use: lookup, search, list, stats', file=sys.stderr)
    sys.exit(1)
PYEOF
