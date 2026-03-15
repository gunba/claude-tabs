/**
 * Test subagent display end-to-end.
 * 1. Launch app
 * 2. Create a session via command bridge
 * 3. Wait for session to be live
 * 4. Create fake subagent JSONL files in the session's subagent directory
 * 5. Wait and check if subagents appear in the store
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { readState, sendCommand, waitForState, sleep } = require("./test-bridge.cjs");

const EXE = path.join(__dirname, "..", "src-tauri", "target", "release", "claude-tabs.exe");

function killApp() {
  try { execSync("taskkill /IM claude-tabs.exe /F", { stdio: "ignore" }); } catch {}
}

async function main() {
  console.log("=== Subagent Display Test ===\n");

  // 1. Launch
  killApp();
  sleep(2000);
  const proc = spawn(EXE, [], { detached: true, stdio: "ignore" });
  proc.unref();
  console.log("Launched app, waiting for init...");

  const initState = waitForState((s) => s.initialized && s.claudePath, 20000);
  if (!initState) {
    console.log("FAIL: App didn't initialize");
    killApp();
    process.exit(1);
  }
  console.log("App initialized. claudePath:", initState.claudePath);
  console.log("Sessions:", initState.sessionCount);

  // 2. Create a session
  console.log("\nCreating test session...");
  sendCommand({
    action: "createSession",
    args: { workingDir: path.join(__dirname, ".."), name: "SubagentTest" },
  });

  // Wait for session to appear
  const withSession = waitForState((s) => s.sessions.some((x) => x.name === "SubagentTest"), 10000);
  if (!withSession) {
    console.log("FAIL: Session not created");
    killApp();
    process.exit(1);
  }

  const testSession = withSession.sessions.find((x) => x.name === "SubagentTest");
  console.log("Session created:", testSession.id.slice(0, 8), "state:", testSession.state);

  // Wait for it to go live (PTY spawns, state becomes idle)
  console.log("Waiting for session to go live...");
  const liveState = waitForState(
    (s) => {
      const sess = s.sessions.find((x) => x.name === "SubagentTest");
      return sess && sess.state !== "starting" && sess.state !== "dead";
    },
    15000
  );

  if (!liveState) {
    console.log("WARN: Session didn't go live (might not have claude CLI). Testing with fake subagent data...");
  } else {
    const liveSession = liveState.sessions.find((x) => x.name === "SubagentTest");
    console.log("Session state:", liveSession.state);
  }

  // 3. Set this session as active
  const sessionId = testSession.id;
  const configSessionId = testSession.sessionId || sessionId;
  sendCommand({ action: "setActiveTab", args: { id: sessionId } });
  sleep(3000);

  // 4. Create fake subagent JSONL files
  const encoded = path.join(__dirname, "..").replace(/:\\/g, "--").replace(/[\\/]/g, "-").replace(/-$/, "");
  const subagentDir = path.join(
    os.homedir(),
    ".claude",
    "projects",
    encoded,
    configSessionId,
    "subagents"
  );
  console.log("\nSubagent dir:", subagentDir);
  fs.mkdirSync(subagentDir, { recursive: true });

  // Write a fake subagent JSONL file
  const fakeSubagentId = "agent-test123";
  const fakeJsonl = path.join(subagentDir, `${fakeSubagentId}.jsonl`);
  const fakeEvents = [
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Analyzing the codebase..." }],
        stop_reason: "tool_use",
      },
    }),
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "x", content: "file contents" }],
      },
    }),
  ];
  fs.writeFileSync(fakeJsonl, fakeEvents.join("\n") + "\n");
  console.log("Wrote fake subagent JSONL:", fakeSubagentId);

  // 5. Wait for subagents to appear in the store
  console.log("Waiting for subagent to appear in store...");
  const subagentState = waitForState(
    (s) => s.subagentMapSize > 0 || Object.keys(s.subagents).length > 0,
    15000,
    1000
  );

  if (subagentState) {
    console.log("\n✓ PASS: Subagents detected!");
    console.log("  SubagentMapSize:", subagentState.subagentMapSize);
    console.log("  Subagents:", JSON.stringify(subagentState.subagents, null, 2));
  } else {
    const finalState = readState();
    console.log("\n✗ FAIL: No subagents detected after 15s");
    console.log("  SubagentMapSize:", finalState?.subagentMapSize);
    console.log("  Active tab:", finalState?.activeTabId);
    console.log("  Sessions:", finalState?.sessions?.map((s) => `${s.name}[${s.state}] id:${s.id.slice(0,8)} sid:${(s.sessionId||"").slice(0,8)}`));
    console.log("  Expected subagent dir:", subagentDir);
    console.log("  Dir exists?", fs.existsSync(subagentDir));
    console.log("  Files in dir:", fs.existsSync(subagentDir) ? fs.readdirSync(subagentDir) : "N/A");
  }

  // Cleanup
  try { fs.unlinkSync(fakeJsonl); } catch {}
  try { fs.rmdirSync(subagentDir); } catch {}

  // Close the test session
  sendCommand({ action: "closeSession", args: { id: sessionId } });
  sleep(3000);
  killApp();
}

main();
