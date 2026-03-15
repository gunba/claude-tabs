# Claude Tabs — Agent Self-Testing Protocol

Agents MUST verify changes themselves before delivering to the user.
The app is a GUI (Tauri + WebView2) — agents can't see the UI, but the test harness
exposes all app state via a JSON file that can be read programmatically.

## Quick Run

```bash
# Build + run full E2E test suite (static analysis + live app tests)
npm run tauri build && node scripts/e2e-test.cjs
```

This:
1. Compiles TypeScript, runs Vitest, checks Rust
2. Launches the built exe
3. Reads app state from the test harness (written to `%LOCALAPPDATA%/claude-tabs/test-state.json`)
4. Verifies: initialization, session state, CLI discovery, slash commands, persistence, JSONL parsing, command discovery
5. Kills the app and reports results

**All 20 checks must pass before delivering a build.**

## How It Works

### Test Harness (`src/lib/testHarness.ts`)
- Writes a JSON snapshot of app state to `test-state.json` every 2 seconds
- Includes: session count/states/metadata, CLI version, option count, slash command count, active tab, etc.
- Always active (lightweight — just serializes Zustand store state)

### E2E Script (`scripts/e2e-test.cjs`)
- Launches the exe, waits for the harness to respond
- Reads and validates the state snapshot
- Also checks persistence files (sessions.json), JSONL files, and binary command discovery
- Reports pass/fail for each check

### Performance Tracing (`src/lib/perfTrace.ts`)
- `trace(event)` and `traceAsync(event, fn)` log timestamped events
- Used in `sessions.ts`, `useCliWatcher.ts`, `useCommandDiscovery.ts`
- To dump traces: temporarily write `dumpTraces()` to a file (see code comments)

## What the E2E Test Verifies

| # | Check | Pass Criteria |
|---|-------|---------------|
| 1 | TypeScript compiles | `npx tsc --noEmit` exits 0 |
| 2 | Tests pass | `npm test` exits 0 |
| 3 | Rust compiles | `cargo check` exits 0 |
| 4 | Exe exists | Built binary present |
| 5 | Test harness responds | State file written within 15s |
| 6 | App initialized | `initialized=true` in state |
| 7 | No meta-agent leaks | All sessions have `isMetaAgent=false` |
| 8 | Claude CLI found | `claudePath` is non-null |
| 9 | CLI version detected | `cliVersion` is non-null |
| 10 | CLI options parsed | >= 30 options from `--help` |
| 11 | CLI subcommands parsed | >= 7 subcommands |
| 12 | Slash commands discovered | >= 20 from binary + plugins |
| 13 | Sessions file readable | `sessions.json` parses correctly |
| 14 | Dead sessions have resume targets | `resumeSession` or `sessionId` present |
| 15 | JSONL first messages extractable | At least 1 user message found |
| 16 | Claude binary found | Version binary exists in `~/.local/share/claude/` |
| 17 | Binary command registrations | >= 50 `name:"...",description:"..."` patterns |
| 18 | Plugin/skill files found | Scans `~/.claude/plugins/` successfully |

## When to Run

- **After every code change**: `node scripts/e2e-test.cjs` (includes static + live)
- **Quick check only**: `npx tsc --noEmit && npm test && cargo check`
- **Performance investigation**: Enable trace dumping (see `perfTrace.ts`)

## Adding New Tests

1. Add state to `TestState` interface in `testHarness.ts`
2. Populate it in `captureState()`
3. Add verification in `e2e-test.cjs`
4. Document in this file
