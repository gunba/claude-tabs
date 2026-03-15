/**
 * Reproduce two reported issues:
 * 1. Terminal flickers/flashes conversation history on new messages
 * 2. Activity feed doesn't show any output
 *
 * Steps:
 * - Launch app
 * - Create a session
 * - Send a message
 * - Monitor: does the feed get entries? What's the settled state?
 * - Also monitor state changes to understand the flicker
 */

const { execSync, spawn } = require("child_process");
const path = require("path");
const { readState, sendCommand, waitForState, sleep } = require("./test-bridge.cjs");

const EXE = path.join(__dirname, "..", "src-tauri", "target", "release", "claude-tabs.exe");
function killApp() { try { execSync("taskkill /IM claude-tabs.exe /F", { stdio: "ignore" }); } catch {} }

function main() {
  console.log("=== Reproducing Issues ===\n");
  killApp(); sleep(2000);
  spawn(EXE, [], { detached: true, stdio: "ignore" }).unref();

  const init = waitForState((s) => s.initialized && s.claudePath, 20000);
  if (!init) { console.log("FAIL: No init"); killApp(); process.exit(1); }
  console.log("✓ Initialized, sessions:", init.sessionCount);

  // Create a fresh session
  sendCommand({ action: "createSession", args: { workingDir: path.join(__dirname, ".."), name: "TestIssues" } });
  const created = waitForState((s) => s.sessions.some((x) => x.name === "TestIssues"), 10000);
  if (!created) { console.log("FAIL: No session"); killApp(); process.exit(1); }
  const sid = created.sessions.find((x) => x.name === "TestIssues").id;
  console.log("✓ Session:", sid.slice(0, 8));

  sendCommand({ action: "setActiveTab", args: { id: sid } });

  // Wait for idle
  console.log("Waiting for idle...");
  const idle = waitForState((s) => s.sessions.find((x) => x.id === sid)?.state === "idle", 20000);
  if (!idle) { console.log("WARN: Not idle"); }
  else console.log("✓ Idle");
  sleep(2000);

  // Check feed state BEFORE sending message
  let state = readState();
  console.log("\n=== Before sending message ===");
  console.log("Feed entries:", state.feedEntryCount);
  console.log("Feed tracking:", JSON.stringify(state.feedTracking));
  console.log("Session state:", state.sessions.find((x) => x.id === sid)?.state);
  console.log("Session msgs:", state.sessions.find((x) => x.id === sid)?.assistantMessageCount);

  // Send a simple message
  console.log("\nSending message...");
  sendCommand({ action: "sendInput", args: { sessionId: sid, text: "Say hello and nothing else.\r" } });

  // Wait for the command to be processed and check result
  sleep(5000);
  state = readState();
  console.log("sendInput result:", JSON.stringify(state?.lastCommandResult));

  // Monitor state changes and feed activity every 2s for 30s
  console.log("\n=== Monitoring (30s) ===");
  let prevMsgs = 0;
  let prevFeedCount = 0;
  let prevState = "";
  for (let i = 0; i < 15; i++) {
    sleep(2000);
    state = readState();
    if (!state) continue;

    const sess = state.sessions.find((x) => x.id === sid);
    const msgs = sess?.assistantMessageCount ?? 0;
    const sessState = sess?.state ?? "?";
    const feedCount = state.feedEntryCount ?? 0;

    // Only log when something changes
    const changed = msgs !== prevMsgs || feedCount !== prevFeedCount || sessState !== prevState;
    if (changed) {
      console.log(`+${(i+1)*2}s  state=${sessState}  msgs=${msgs}  feed=${feedCount}  tracking=${JSON.stringify(state.feedTracking)}`);
      if (state.feedLastEntry) {
        console.log(`  lastEntry: [${state.feedLastEntry.type}] ${state.feedLastEntry.message?.slice(0, 60)}`);
      }
    }
    prevMsgs = msgs;
    prevFeedCount = feedCount;
    prevState = sessState;

    // Stop early if we got a response and feed entry
    if (msgs > 0 && feedCount > 0 && sessState === "idle") {
      console.log("\n✓ Both issues checked — got response + feed entry");
      break;
    }
  }

  console.log("\n=== Final state ===");
  state = readState();
  const sess = state?.sessions.find((x) => x.id === sid);
  console.log("Session state:", sess?.state);
  console.log("Session msgs:", sess?.assistantMessageCount);
  console.log("Feed entries:", state?.feedEntryCount);
  console.log("Feed tracking:", JSON.stringify(state?.feedTracking));

  if (state?.feedEntryCount === 0) {
    console.log("\n✗ ISSUE CONFIRMED: Activity feed has 0 entries despite conversation");
    console.log("  The 'settled' flag is likely stuck at false");
  }

  // Cleanup
  sendCommand({ action: "closeSession", args: { id: sid } });
  sleep(3000);
  killApp();
}

main();
