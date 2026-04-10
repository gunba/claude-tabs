import { getSessionTranscript, waitForRender, isAltScreen, scrollBufferToText } from "./terminalRegistry";
import { writeToPty } from "./ptyRegistry";
import { dlog } from "./debugLog";

const PAGE_UP = "\x1b[5~";
const CTRL_END = "\x1b[1;5F";

// Strip ANSI escape codes and normalize whitespace for fuzzy viewport matching.
function normalizeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Scroll a Claude Code TUI to make `targetText` visible in the terminal viewport.
 *
 * Sends Page Up keys to the PTY (Claude Code's TUI handles the scroll), waits for
 * xterm.js onRender (deterministic — no timers), and checks the viewport text after
 * each scroll. Stops when the target is found or the viewport stops changing (edge).
 *
 * Returns true if the text was found in the viewport, false otherwise.
 */
export async function scrollTuiToText(
  sessionId: string,
  targetText: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (!isAltScreen(sessionId)) {
    dlog("search", sessionId, "scrollTuiToText: not in alt-screen, trying buffer scroll", "DEBUG");
    return scrollBufferToText(sessionId, targetText);
  }

  const normalizedTarget = normalizeText(targetText);
  if (!normalizedTarget) return false;

  // Check if already visible
  const currentText = getSessionTranscript(sessionId);
  if (currentText && normalizeText(currentText).includes(normalizedTarget)) {
    dlog("search", sessionId, "scrollTuiToText: target already visible in viewport");
    return true;
  }

  // Jump to bottom first to establish a known position
  writeToPty(sessionId, CTRL_END);
  await waitForRender(sessionId);

  if (signal.aborted) return false;

  let prevViewport = "";
  const MAX_SCROLLS = 500; // Safety limit

  for (let i = 0; i < MAX_SCROLLS; i++) {
    if (signal.aborted) return false;

    // Send Page Up
    writeToPty(sessionId, PAGE_UP);
    await waitForRender(sessionId);

    if (signal.aborted) return false;

    const viewport = getSessionTranscript(sessionId) ?? "";
    const normalized = normalizeText(viewport);

    // Check if target text is now visible
    if (normalized.includes(normalizedTarget)) {
      dlog("search", sessionId, `scrollTuiToText: found after ${i + 1} scrolls`);
      return true;
    }

    // Edge detection: viewport unchanged means we hit top
    if (viewport === prevViewport) {
      dlog("search", sessionId, `scrollTuiToText: hit edge after ${i + 1} scrolls`);
      return false;
    }

    prevViewport = viewport;
  }

  dlog("search", sessionId, "scrollTuiToText: hit scroll limit", "WARN");
  return false;
}
