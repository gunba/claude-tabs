const { execSync, spawn } = require("child_process");
const path = require("path");
const { readState, sendCommand, waitForState, sleep } = require("./test-bridge.cjs");

const EXE = path.join(__dirname, "..", "src-tauri", "target", "release", "claude-tabs.exe");
function killApp() { try { execSync("taskkill /IM claude-tabs.exe /F", { stdio: "ignore" }); } catch {} }

function main() {
  console.log("=== Real Subagent E2E Test ===\n");
  killApp(); sleep(2000);
  spawn(EXE, [], { detached: true, stdio: "ignore" }).unref();

  const init = waitForState((s) => s.initialized && s.claudePath, 20000);
  if (!init) { console.log("FAIL: No init"); killApp(); process.exit(1); }
  console.log("✓ Initialized");

  sendCommand({ action: "createSession", args: { workingDir: path.join(__dirname, ".."), name: "AgentTest" } });
  const created = waitForState((s) => s.sessions.some((x) => x.name === "AgentTest"), 10000);
  if (!created) { console.log("FAIL: No session"); killApp(); process.exit(1); }
  const sid = created.sessions.find((x) => x.name === "AgentTest").id;
  console.log("✓ Session:", sid.slice(0, 8));

  sendCommand({ action: "setActiveTab", args: { id: sid } });

  console.log("Waiting for idle...");
  const ready = waitForState((s) => s.sessions.find((x) => x.id === sid)?.state === "idle", 20000);
  if (!ready) { console.log("FAIL: Not idle"); killApp(); process.exit(1); }
  console.log("✓ Idle");
  sleep(1500);

  // Send prompt
  sendCommand({
    action: "sendInput",
    args: { sessionId: sid, text: "Use 2 parallel Agent subagents: agent 1 counts 1 to 5, agent 2 lists 3 animals. Do NOT touch any files.\r" },
  });
  console.log("✓ Prompt sent");

  // Poll actively, printing state every 3s
  console.log("\nPolling for subagents (120s max)...");
  const start = Date.now();
  let found = false;
  while (Date.now() - start < 120000) {
    sleep(3000);
    const s = readState();
    if (!s) continue;
    const sess = s.sessions.find((x) => x.id === sid);
    const subCount = Object.values(s.subagents).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`  +${Math.round((Date.now()-start)/1000)}s  state=${sess?.state}  subs=${subCount}  mapSize=${s.subagentMapSize}`);

    if (subCount > 0) {
      console.log("\n✓ PASS: Subagents detected!");
      for (const [key, subs] of Object.entries(s.subagents)) {
        for (const sub of subs) {
          console.log(`  ${sub.id.slice(0,15)} [${sub.state}] ${sub.description.slice(0,60)}`);
        }
      }
      found = true;
      break;
    }
    // Stop if session went back to idle (Claude finished without us catching subagents)
    if (sess?.state === "idle" && Date.now() - start > 15000) {
      console.log("\n  Session went idle — Claude may have finished. Checking one more time...");
      sleep(5000);
      const final = readState();
      const finalSubs = Object.values(final.subagents).reduce((sum, arr) => sum + arr.length, 0);
      if (finalSubs > 0) {
        console.log("✓ PASS (late detection)");
        found = true;
      }
      break;
    }
  }

  if (!found) {
    console.log("\n✗ FAIL: No subagents detected");
    const final = readState();
    console.log("  Final state:", final?.sessions.find((x) => x.id === sid)?.state);
    console.log("  AssistantMsgCount:", final?.sessions.find((x) => x.id === sid)?.assistantMessageCount);
  }

  // Cleanup
  console.log("\nCleaning up...");
  waitForState((s) => s.sessions.find((x) => x.id === sid)?.state === "idle", 60000);
  sendCommand({ action: "closeSession", args: { id: sid } });
  sleep(3000);
  killApp();
}

main();
