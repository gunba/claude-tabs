#!/bin/bash
# audit-rules.sh — Check rule file health: granularity, path overlaps, stale paths, zero-utility tags
set -euo pipefail
if [ -n "$LOCALAPPDATA" ]; then PYTHON=$(command -v python 2>/dev/null || command -v py 2>/dev/null); else PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null); fi
export PYTHONUTF8=1
$PYTHON - << 'PYEOF'
import json, os, re, sys, fnmatch, glob as _glob
root = os.popen('git rev-parse --show-toplevel 2>/dev/null').read().strip() or '.'
proofs_dir = os.path.join(root, '.proofs')
config_path = os.path.join(proofs_dir, 'config.json')
try:
    with open(config_path) as f:
        _config = json.load(f)
except:
    _config = {}
rule_files = []
for _rd in _config.get('rule_dirs', ['.claude/rules']):
    _dir = os.path.join(root, _rd)
    rule_files.extend(sorted(_glob.glob(os.path.join(_dir, '*.md'))))
rule_files.extend(os.path.join(root, d) for d in _config.get('docs', []))
tracked = set(os.popen('git ls-files 2>/dev/null').read().strip().split('\n'))
for d in ['src', 'src-tauri/src']:
    dp = os.path.join(root, d)
    if os.path.isdir(dp):
        for dirpath, _, fnames in os.walk(dp):
            for fn in fnames:
                tracked.add(os.path.relpath(os.path.join(dirpath, fn), root).replace(os.sep, '/'))
warnings = []
rule_data = {}
for filepath in rule_files:
    fname = os.path.basename(filepath)
    if not fname.endswith('.md'): continue
    with open(filepath, 'r', encoding='utf-8') as f: content = f.read()
    tags = re.findall(r'^\- \[([A-Z]{2}-\d{2,3})\]', content, re.M)
    paths = []
    if content.startswith('---'):
        end = content.find('---', 3)
        if end != -1:
            in_p = False
            for line in content[3:end].strip().split('\n'):
                s = line.strip()
                if s.startswith('paths:'): in_p = True; continue
                if in_p and s.startswith('- '): paths.append(s[2:].strip().strip('"').strip("'")); continue
                if in_p: break
    rule_data[fname] = {'tags': tags, 'paths': paths}
    if len(tags) > 12: warnings.append(f'GRANULARITY: {fname} has {len(tags)} tags (max 12)')
    for pat in paths:
        if not any(fnmatch.fnmatch(tf, pat) or ('**' in pat and tf.startswith(pat.split('**')[0].rstrip('/')+'/')) for tf in tracked):
            warnings.append(f'STALE PATH: {fname}: "{pat}" matches 0 files')
for tf in sorted(tracked):
    if not any(tf.endswith(e) for e in ('.ts','.tsx','.rs')): continue
    total, rules = 0, []
    for fn, d in rule_data.items():
        if not d['paths']:
            total += len(d['tags']); rules.append(fn); continue
        for pat in d['paths']:
            if fnmatch.fnmatch(tf, pat) or ('**' in pat and tf.startswith(pat.split('**')[0].rstrip('/')+'/')):
                total += len(d['tags']); rules.append(fn); break
    if total > 20:
        rs = ', '.join(f'{r}({len(rule_data[r]["tags"])})' for r in rules)
        warnings.append(f'CONTEXT FLOOD: {tf} loads {total} tags from {len(rules)} rules: {rs}')
for fn, d in rule_data.items():
    base = fn.replace('.md', '').lower()
    sp = os.path.join(proofs_dir, f'prove-{base}.json')
    try:
        with open(sp) as f: state = json.load(f)
        cycle = state.get('cycle', 0)
        if cycle >= 3:
            for tag in d['tags']:
                c = state.get('citations', {}).get(tag, {})
                if c.get('up', 0) == 0 and c.get('seen', 0) >= 3:
                    warnings.append(f'ZERO UTILITY: [{tag}] in {fn} -- 0 upvotes across {c["seen"]} seen (cycle {cycle})')
    except: pass
if not warnings: print('All rule files healthy.')
else:
    print(f'{len(warnings)} warning(s):')
    for w in sorted(warnings): print(f'  - {w}')
PYEOF
