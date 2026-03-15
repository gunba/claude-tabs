/**
 * Test bridge — send commands to the running Claude Tabs app and read results.
 *
 * Usage:
 *   const { sendCommand, readState, waitForState } = require('./test-bridge.cjs');
 *   await sendCommand({ action: "createSession", args: { workingDir: ".", name: "Test" } });
 *   const state = await waitForState(s => s.sessionCount > 0);
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(os.homedir(), "AppData", "Local", "claude-tabs");
const STATE_FILE = path.join(DATA_DIR, "test-state.json");
const CMD_FILE = path.join(DATA_DIR, "test-commands.json");

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

/** Read current test state from the running app. Returns null if unavailable. */
function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.__test_state__ || null;
  } catch {
    return null;
  }
}

/** Send a command to the running app. The harness polls every 2s. */
function sendCommand(cmd) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CMD_FILE, JSON.stringify(cmd));
}

/**
 * Wait for a state condition to be true, polling every interval.
 * Returns the matching state or null on timeout.
 */
function waitForState(predicate, timeoutMs = 15000, intervalMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = readState();
    if (state && predicate(state)) return state;
    sleep(intervalMs);
  }
  return null;
}

/**
 * Send a command and wait for the result to appear in lastCommandResult.
 */
function sendAndWait(cmd, timeoutMs = 15000) {
  const beforeTs = Date.now();
  sendCommand(cmd);

  // Wait for the harness to process (polls every 2s) and state to update
  const state = waitForState(
    (s) => s.timestamp > beforeTs + 1000 && s.lastCommandResult !== null,
    timeoutMs,
    500
  );
  return state?.lastCommandResult ?? null;
}

module.exports = { readState, sendCommand, waitForState, sendAndWait, sleep };
