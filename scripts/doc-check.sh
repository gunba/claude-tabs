#!/bin/bash
# Documentation Validation Script for Claude Tabs
#
# Checks that project documentation stays consistent with actual code.
# Run after making changes: bash scripts/doc-check.sh
#
# Future agents: run this script after making significant changes.
# It validates documentation, CSS conventions, theme system, and builds.
#
# Exit codes:
#   0 = all checks pass
#   1+ = number of errors found

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

ERRORS=0
WARNINGS=0

pass()  { echo "  [PASS] $1"; }
fail()  { echo "  [FAIL] $1"; ERRORS=$((ERRORS + 1)); }
warn()  { echo "  [WARN] $1"; WARNINGS=$((WARNINGS + 1)); }

echo "=== Claude Tabs -- Documentation Check ==="
echo ""

# -- 1. Build checks --
echo "1. Build Verification"

if npx tsc --noEmit 2>/dev/null; then
  pass "TypeScript compiles cleanly"
else
  fail "TypeScript compilation errors — run 'npx tsc --noEmit' for details"
fi

TEST_OUTPUT=$(npm test 2>&1 || true)
# Extract test counts (compatible with Git Bash — no grep -P)
ACTUAL_TESTS=$(echo "$TEST_OUTPUT" | grep "Tests" | grep -v "Test Files" | sed 's/.*[^0-9]\([0-9][0-9]*\) passed.*/\1/')
ACTUAL_FILES=$(echo "$TEST_OUTPUT" | grep "Test Files" | sed 's/.*[^0-9]\([0-9][0-9]*\) passed.*/\1/')

if [ -n "$ACTUAL_TESTS" ]; then
  pass "Tests: $ACTUAL_TESTS passing across ${ACTUAL_FILES:-?} files"

  # Compare with docs/STATUS.md
  STATUS_TESTS=$(sed -n 's/.*(\([0-9]*\)\/[0-9]*).*$/\1/p' docs/STATUS.md | head -1)
  if [ -z "$STATUS_TESTS" ]; then
    STATUS_TESTS=$(sed -n 's/.*\([0-9][0-9]*\) unit tests.*/\1/p' docs/STATUS.md | head -1)
  fi
  if [ -n "$STATUS_TESTS" ] && [ "$STATUS_TESTS" != "$ACTUAL_TESTS" ]; then
    warn "docs/STATUS.md says $STATUS_TESTS tests but actual is $ACTUAL_TESTS — update docs/STATUS.md"
  fi

  # Compare with CLAUDE.md
  CLAUDE_TESTS=$(sed -n 's/.*# \([0-9][0-9]*\) tests across.*/\1/p' CLAUDE.md | head -1)
  if [ -n "$CLAUDE_TESTS" ] && [ "$CLAUDE_TESTS" != "$ACTUAL_TESTS" ]; then
    warn "CLAUDE.md says $CLAUDE_TESTS tests but actual is $ACTUAL_TESTS — update CLAUDE.md"
  fi
else
  fail "Tests failed or no tests found"
fi

echo ""

# -- 2. File inventory check (docs/STATUS.md) --
echo "2. File Inventory (docs/STATUS.md)"

# Collect inventory file paths into array
INVENTORY_FILES=()
MISSING=0
CHECKED=0
while IFS='|' read -r _ file _ _; do
  file=$(echo "$file" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -z "$file" ] || [ "$file" = "File" ] || echo "$file" | grep -q '^---'; then
    continue
  fi
  file=$(echo "$file" | tr -d '`')
  if [ -z "$file" ]; then continue; fi
  CHECKED=$((CHECKED + 1))
  INVENTORY_FILES+=("$file")
  if [ ! -f "$file" ]; then
    fail "Listed in inventory but missing: $file"
    MISSING=$((MISSING + 1))
  fi
done < <(sed -n '/^| File/,/^$/p' docs/STATUS.md)

if [ $MISSING -eq 0 ] && [ $CHECKED -gt 0 ]; then
  pass "All $CHECKED inventory files exist"
fi

# Check for source files NOT in inventory (new files that were missed)
NEW_FILES=0
for actual_file in \
  src/lib/*.ts \
  src/lib/__tests__/*.ts \
  src/hooks/*.ts \
  src/store/*.ts \
  src/types/*.ts \
  src/components/*/*.tsx \
  src/components/*/*.css \
  src/App.tsx src/App.css src/main.tsx \
  src-tauri/src/lib.rs src-tauri/src/commands.rs src-tauri/src/jsonl_watcher.rs \
  src-tauri/src/session/*.rs; do
  [ ! -f "$actual_file" ] && continue
  FOUND=0
  for inv_file in "${INVENTORY_FILES[@]}"; do
    if [ "$actual_file" = "$inv_file" ]; then
      FOUND=1
      break
    fi
  done
  if [ $FOUND -eq 0 ]; then
    warn "Source file not in docs/STATUS.md inventory: $actual_file"
    NEW_FILES=$((NEW_FILES + 1))
  fi
done

if [ $NEW_FILES -eq 0 ]; then
  pass "No unlisted source files found"
fi

echo ""

# -- 3. CSS convention check --
echo "3. CSS Convention (no hardcoded hex)"

HEX_VIOLATIONS=$(grep -rn '#[0-9a-fA-F]\{6\}' src/components/ --include="*.css" \
  | grep -v 'border-radius' \
  | grep -v 'node_modules' \
  || true)

if [ -z "$HEX_VIOLATIONS" ]; then
  pass "No hardcoded hex colors in component CSS"
else
  VIOLATION_COUNT=$(echo "$HEX_VIOLATIONS" | wc -l)
  warn "$VIOLATION_COUNT hardcoded hex value(s) found in component CSS:"
  echo "$HEX_VIOLATIONS" | head -5 | sed 's/^/      /'
  if [ "$VIOLATION_COUNT" -gt 5 ]; then
    echo "      ... and $((VIOLATION_COUNT - 5)) more"
  fi
fi

echo ""

# -- 4. Theme variable completeness --
echo "4. Theme System"

# Check CSS vars defined in theme.ts
DEFINED_VARS=$(grep 'setProperty("--' src/lib/theme.ts 2>/dev/null \
  | sed 's/.*setProperty("--//;s/".*//' \
  | sort -u || true)

INDEX_VARS=$(grep -E '^\s+--[a-z]' index.html 2>/dev/null \
  | sed 's/^[[:space:]]*--//;s/:.*//' \
  | sort -u || true)

ALL_DEFINED=$(echo -e "$DEFINED_VARS\n$INDEX_VARS" | sort -u)

# Find CSS vars used in source
USED_VARS=$(grep -roh 'var(--[a-z][a-z-]*)' src/ --include="*.css" --include="*.tsx" 2>/dev/null \
  | sed 's/var(--//;s/)//' \
  | sort -u || true)

UNDEFINED=0
while IFS= read -r var; do
  [ -z "$var" ] && continue
  if ! echo "$ALL_DEFINED" | grep -qx "$var"; then
    warn "CSS var --$var used but not defined in theme.ts or index.html"
    UNDEFINED=$((UNDEFINED + 1))
  fi
done <<< "$USED_VARS"

DEFINED_COUNT=$(echo "$ALL_DEFINED" | grep -c . || true)
USED_COUNT=$(echo "$USED_VARS" | grep -c . || true)

if [ $UNDEFINED -eq 0 ]; then
  pass "All $USED_COUNT CSS variables are defined ($DEFINED_COUNT in theme system)"
fi

echo ""

# -- 5. Documentation freshness --
echo "5. Documentation Files"

for doc in CLAUDE.md docs/ARCHITECTURE.md docs/STATUS.md docs/TESTING.md; do
  if [ -f "$doc" ]; then
    pass "$doc exists"
  else
    fail "$doc missing"
  fi
done

echo ""

# -- 6. Rust compilation --
echo "6. Rust Backend"

if (cd src-tauri && cargo check 2>/dev/null); then
  pass "Rust compiles"
else
  # Try again with visible errors
  RUST_OUT=$(cd src-tauri && cargo check 2>&1 || true)
  if echo "$RUST_OUT" | grep -q "error\["; then
    fail "Rust compilation errors"
  else
    pass "Rust compiles (with warnings)"
  fi
fi

echo ""

# -- 7. Hardcoded hex in TSX --
echo "7. TSX Convention (no hardcoded hex in inline styles)"

TSX_HEX=$(grep -rn '"#[0-9a-fA-F]\{6\}"' src/ --include="*.tsx" \
  | grep -v 'node_modules' \
  | grep -v '__tests__' \
  | grep -v 'theme.ts' \
  || true)

if [ -z "$TSX_HEX" ]; then
  pass "No hardcoded hex in TSX files"
else
  TSX_COUNT=$(echo "$TSX_HEX" | wc -l)
  warn "$TSX_COUNT hardcoded hex value(s) found in TSX files:"
  echo "$TSX_HEX" | head -5 | sed 's/^/      /'
fi

echo ""

# -- Summary --
echo "==========================================="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo "All checks passed."
elif [ $ERRORS -eq 0 ]; then
  echo "$WARNINGS warning(s), 0 errors."
else
  echo "$ERRORS error(s), $WARNINGS warning(s)."
fi
echo ""

exit $ERRORS
