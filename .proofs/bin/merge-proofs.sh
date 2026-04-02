#!/bin/bash
# merge-proofs.sh — Three-way merge for .proofs/ JSON state files
# Usage: merge-proofs.sh <branch-name>
set -euo pipefail

BRANCH="${1:?Usage: merge-proofs.sh <branch-name>}"
if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1
PROOFS_DIR="$(git rev-parse --show-toplevel)/.proofs"

# Find conflicted .proofs/ files
CONFLICTED=$(git diff --name-only --diff-filter=U | grep '\.proofs/' || true)

# Handle JSONL conflicts (append-only logs): union lines, deduplicate, sort by timestamp
JSONL_CONFLICTS=$(echo "$CONFLICTED" | grep '\.jsonl$' || true)
if [ -n "$JSONL_CONFLICTS" ]; then
    echo "Resolving JSONL conflicts..."
    for file in $JSONL_CONFLICTS; do
        echo "  Resolving: $file"
        MERGE_BASE=$(git merge-base HEAD "$BRANCH")
        $PYTHON -c "
import json, sys, subprocess

filepath, branch, merge_base = sys.argv[1], sys.argv[2], sys.argv[3]

def get_lines(ref, path):
    r = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True, text=True)
    if r.returncode != 0:
        return []
    return [l.strip() for l in r.stdout.strip().split(chr(10)) if l.strip()]

ours_lines = get_lines('HEAD', filepath)
theirs_lines = get_lines(branch, filepath)

# Union: deduplicate by exact content, preserve order by timestamp
seen = set()
merged = []
for line in ours_lines + theirs_lines:
    if line not in seen:
        seen.add(line)
        merged.append(line)

# Sort by timestamp if JSON with 'ts' field
def sort_key(line):
    try:
        return json.loads(line).get('ts', '')
    except:
        return ''

merged.sort(key=sort_key)

with open(filepath, 'w') as f:
    f.write(chr(10).join(merged) + chr(10) if merged else '')

print(f'    Merged: {len(merged)} lines ({len(ours_lines)} ours + {len(theirs_lines)} theirs, {len(ours_lines) + len(theirs_lines) - len(merged)} deduped)')
" "$file" "$BRANCH" "$MERGE_BASE"
        git add "$file"
    done
fi

# Handle .proofs/ JSON state files (excluding .jsonl already handled)
JSON_CONFLICTS=$(echo "$CONFLICTED" | grep -v '\.jsonl$' || true)
for file in $JSON_CONFLICTS; do
    echo "  Resolving: $file"
    $PYTHON -c "
import json, sys, subprocess

filepath = sys.argv[1]
branch = sys.argv[2]

# Get three versions: base (merge-base), ours (HEAD), theirs (branch)
merge_base = subprocess.run(['git', 'merge-base', 'HEAD', branch], capture_output=True, text=True).stdout.strip()

def get_version(ref, path):
    result = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True, text=True)
    return json.loads(result.stdout) if result.returncode == 0 else {}

base = get_version(merge_base, filepath)
ours = get_version('HEAD', filepath)
theirs = get_version(branch, filepath)

# Merge strategy: union tags, sum citation deltas, take newer metadata
merged = dict(ours)  # start from ours

# Union all_tags
all_tags = sorted(set(ours.get('all_tags', []) + theirs.get('all_tags', [])))
merged['all_tags'] = all_tags

# Union unchecked
unchecked = sorted(set(ours.get('unchecked', []) + theirs.get('unchecked', [])))
merged['unchecked'] = unchecked

# Merge citations: sum deltas from base
base_cites = base.get('citations', {})
ours_cites = ours.get('citations', {})
theirs_cites = theirs.get('citations', {})

merged_cites = {}
for tag in set(list(ours_cites.keys()) + list(theirs_cites.keys())):
    b = base_cites.get(tag, {'up': 0, 'seen': 0})
    o = ours_cites.get(tag, {'up': 0, 'seen': 0})
    t = theirs_cites.get(tag, {'up': 0, 'seen': 0})
    merged_cites[tag] = {
        'up': max(o.get('up', 0), t.get('up', 0)),
        'seen': max(o.get('seen', 0), t.get('seen', 0))
    }
merged['citations'] = merged_cites

# Merge metadata: take newer verified date
ours_meta = ours.get('metadata', {})
theirs_meta = theirs.get('metadata', {})
merged_meta = dict(ours_meta)
for tag, meta in theirs_meta.items():
    if tag not in merged_meta or meta.get('verified', '') > merged_meta.get(tag, {}).get('verified', ''):
        merged_meta[tag] = meta
merged['metadata'] = merged_meta

# Take higher cycle count
merged['cycle'] = max(ours.get('cycle', 1), theirs.get('cycle', 1))

with open(filepath, 'w') as f:
    json.dump(merged, f, indent=2)

print(f'    Merged: {len(all_tags)} tags, {len(merged_cites)} citations')
" "$file" "$BRANCH"
    git add "$file"
done

echo "Proof state merge complete."
