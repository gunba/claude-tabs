/**
 * End-to-end self-test for Claude Tabs.
 * Launches the app, reads test state from the harness, verifies everything.
 *
 * Usage: node scripts/e2e-test.cjs
 *
 * Requirements:
 * - App must be built: npm run tauri build
 * - No existing claude-tabs.exe running
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const EXE = path.join(__dirname, "..", "src-tauri", "target", "release", "claude-tabs.exe");
const STATE_FILE = path.join(os.homedir(), "AppData", "Local", "claude-tabs", "test-state.json");
const SESSIONS_FILE = path.join(os.homedir(), "AppData", "Local", "claude-tabs", "sessions.json");

let appProcess = null;
const results = [];

function log(msg) { console.log(`  ${msg}`); }
function pass(name) { results.push({ name, pass: true }); log(`\x1b[32m✓\x1b[0m ${name}`); }
function fail(name, reason) { results.push({ name, pass: false, reason }); log(`\x1b[31m✗\x1b[0m ${name}: ${reason}`); }

function readTestState(maxWait = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.__test_state__ && parsed.__test_state__.timestamp > start - 5000) {
        return parsed.__test_state__;
      }
    } catch {}
    // Busy wait 500ms
    const end = Date.now() + 500;
    while (Date.now() < end) {}
  }
  return null;
}

function killApp() {
  try { execSync("taskkill /IM claude-tabs.exe /F", { stdio: "ignore" }); } catch {}
}

// ── Tests ───────────────────────────────────────────────────────────

function testStaticAnalysis() {
  console.log("\n── Static Analysis ──");
  try {
    execSync("npx tsc --noEmit", { stdio: "pipe", cwd: path.join(__dirname, "..") });
    pass("TypeScript compiles");
  } catch { fail("TypeScript compiles", "tsc errors"); }

  try {
    const out = execSync("npm test", { stdio: "pipe", cwd: path.join(__dirname, ".."), encoding: "utf8" });
    const match = out.match(/(\d+) passed/);
    pass(`Vitest tests pass (${match ? match[1] : "?"})`);
  } catch { fail("Vitest tests pass", "test failures"); }

  try {
    execSync("cargo check", { stdio: "pipe", cwd: path.join(__dirname, "..", "src-tauri") });
    pass("Rust compiles");
  } catch { fail("Rust compiles", "cargo errors"); }
}

function testStartup() {
  console.log("\n── Startup ──");

  if (!fs.existsSync(EXE)) {
    fail("Exe exists", "not found at " + EXE);
    return false;
  }
  pass("Exe exists");

  killApp();
  // Small delay after kill
  const end = Date.now() + 2000;
  while (Date.now() < end) {}

  appProcess = spawn(EXE, [], { detached: true, stdio: "ignore" });
  appProcess.unref();

  // Wait for harness to respond AND app to initialize
  let state = null;
  const initStart = Date.now();
  while (Date.now() - initStart < 15000) {
    state = readTestState(2000);
    if (state && state.initialized) break;
    const pause = Date.now() + 500;
    while (Date.now() < pause) {}
  }

  if (!state) {
    fail("Test harness responds", "no state file after 15s");
    return false;
  }
  pass("Test harness responds");

  if (state.initialized) pass("App initialized");
  else fail("App initialized", "initialized=false after 15s");

  return true;
}

function testSessionState(state) {
  console.log("\n── Session State ──");

  log(`Sessions: ${state.sessionCount}, Active: ${state.activeTabId || "none"}`);
  for (const s of state.sessions) {
    log(`  ${s.name} [${s.state}] summary=${s.nodeSummary ? "yes" : "no"} msgs=${s.assistantMessageCount}`);
  }

  // Verify no meta-agent sessions leak through
  const metaLeaks = state.sessions.filter(s => s.isMetaAgent);
  if (metaLeaks.length === 0) pass("No meta-agent sessions exposed");
  else fail("No meta-agent sessions exposed", `${metaLeaks.length} leaked`);
}

function testCliDiscovery(state) {
  console.log("\n── CLI Discovery ──");

  if (state.claudePath) pass(`Claude CLI found: ${state.claudePath}`);
  else fail("Claude CLI found", "claudePath is null");

  if (state.cliVersion) pass(`CLI version: ${state.cliVersion}`);
  else fail("CLI version detected", "null");

  if (state.cliOptionCount >= 30) pass(`CLI options parsed: ${state.cliOptionCount}`);
  else fail(`CLI options parsed (>=30)`, `only ${state.cliOptionCount}`);

  if (state.cliCommandCount >= 7) pass(`CLI subcommands parsed: ${state.cliCommandCount}`);
  else fail(`CLI subcommands parsed (>=7)`, `only ${state.cliCommandCount}`);
}

function testSlashCommands(state) {
  console.log("\n── Slash Commands ──");

  if (state.slashCommandCount >= 20) pass(`Slash commands discovered: ${state.slashCommandCount}`);
  else fail(`Slash commands discovered (>=20)`, `only ${state.slashCommandCount}`);
}

function testPersistence() {
  console.log("\n── Persistence ──");

  if (!fs.existsSync(SESSIONS_FILE)) {
    log("No sessions.json — skipping persistence checks");
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
    pass(`Sessions file readable: ${data.length} sessions`);

    // Check that metadata is preserved (not all zeros)
    const withSummary = data.filter(s => s.metadata?.nodeSummary);
    log(`  Sessions with summaries: ${withSummary.length}/${data.length}`);

    // Check revival chain integrity
    for (const s of data) {
      if (s.state === "dead") {
        const resumeTarget = s.config.resumeSession || s.config.sessionId || s.id;
        if (resumeTarget) {
          pass(`Dead session "${s.name}" has resume target`);
        } else {
          fail(`Dead session "${s.name}" has resume target`, "no resumeSession or sessionId");
        }
      }
    }
  } catch (e) {
    fail("Sessions file readable", e.message);
  }
}

function testJsonlFirstMessage() {
  console.log("\n── JSONL First Message ──");

  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsDir)) {
    log("No projects dir — skipping");
    return;
  }

  const dirs = fs.readdirSync(projectsDir).slice(0, 3);
  let found = 0;
  for (const d of dirs) {
    const full = path.join(projectsDir, d);
    if (!fs.statSync(full).isDirectory()) continue;
    const files = fs.readdirSync(full).filter(f => f.endsWith(".jsonl")).slice(0, 1);
    for (const f of files) {
      const lines = fs.readFileSync(path.join(full, f), "utf8").split("\n").filter(Boolean);
      for (const line of lines.slice(0, 20)) {
        try {
          const j = JSON.parse(line);
          if (j.type === "user") {
            const content = j.message?.content;
            const text = Array.isArray(content)
              ? content.find(b => b.type === "text")?.text
              : typeof content === "string" ? content : null;
            if (text && text.length > 20 && !text.includes("command-name")) {
              found++;
              break;
            }
          }
        } catch {}
      }
    }
  }
  if (found > 0) pass(`JSONL first messages extractable: ${found}`);
  else fail("JSONL first messages extractable", "none found");
}

function testCommandDiscoveryFiles() {
  console.log("\n── Command Discovery Files ──");

  // Binary scan
  const versionsDir = path.join(os.homedir(), ".local", "share", "claude", "versions");
  if (fs.existsSync(versionsDir)) {
    const versions = fs.readdirSync(versionsDir).sort();
    if (versions.length > 0) {
      const binaryPath = path.join(versionsDir, versions[versions.length - 1]);
      const stat = fs.statSync(binaryPath);
      pass(`Claude binary found: ${versions[versions.length - 1]} (${Math.round(stat.size / 1024 / 1024)}MB)`);

      // Quick check that the registration pattern exists
      const content = fs.readFileSync(binaryPath, "utf8");
      const re = /name:"([\w][\w-]*)",description:"([^"]*?)"/g;
      let count = 0;
      while (re.exec(content)) count++;
      if (count >= 50) pass(`Binary command registrations: ${count}`);
      else fail(`Binary command registrations (>=50)`, `only ${count}`);
    } else {
      fail("Claude binary found", "no versions in dir");
    }
  } else {
    fail("Claude binary found", "versions dir doesn't exist");
  }

  // Plugin scan
  const pluginsDir = path.join(os.homedir(), ".claude", "plugins");
  if (fs.existsSync(pluginsDir)) {
    let skillCount = 0;
    function scan(dir) {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) scan(full);
          else if (entry.name === "SKILL.md" || (entry.name.endsWith(".md") && path.basename(path.dirname(full)) === "commands")) {
            skillCount++;
          }
        }
      } catch {}
    }
    scan(pluginsDir);
    pass(`Plugin/skill files found: ${skillCount}`);
  }
}

function testHooksDiscovery() {
  console.log("\n── Hooks Discovery ──");
  // Check settings files for hooks config
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  if (fs.existsSync(settingsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      const hookCount = data.hooks ? Object.keys(data.hooks).length : 0;
      pass(`User hooks config readable: ${hookCount} event types`);
    } catch (e) {
      fail("User hooks config readable", e.message);
    }
  } else {
    log("No user settings.json — skipping hooks check");
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("═══ Claude Tabs E2E Self-Test ═══");

  testStaticAnalysis();

  const started = testStartup();
  if (!started) {
    console.log("\n\x1b[31mApp failed to start — aborting runtime tests\x1b[0m");
    killApp();
    process.exit(1);
  }

  // Wait a bit more for discovery to complete
  log("Waiting for background discovery...");
  const end = Date.now() + 5000;
  while (Date.now() < end) {}

  // Re-read state after discovery
  const state = readTestState(5000);
  if (!state) {
    fail("State re-read", "timeout");
    killApp();
    process.exit(1);
  }

  testSessionState(state);
  testCliDiscovery(state);
  testSlashCommands(state);
  testPersistence();
  testJsonlFirstMessage();
  testCommandDiscoveryFiles();
  testHooksDiscovery();

  // Cleanup
  killApp();

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter(r => !r.pass)) {
      console.log(`  \x1b[31m✗\x1b[0m ${r.name}: ${r.reason}`);
    }
    process.exit(1);
  }
}

main();
