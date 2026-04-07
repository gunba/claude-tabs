// [TR-16] Terminal buffer reader and render-wait registry

import type { Terminal } from "@xterm/xterm";

const bufferReaders = new Map<string, () => string>();
const terminals = new Map<string, Terminal>();

export function registerBufferReader(sessionId: string, getBufferText: () => string): void {
  bufferReaders.set(sessionId, getBufferText);
}

export function unregisterBufferReader(sessionId: string): void {
  bufferReaders.delete(sessionId);
}

export function getSessionTranscript(sessionId: string): string | null {
  const reader = bufferReaders.get(sessionId);
  return reader ? reader() : null;
}

export function registerTerminal(sessionId: string, term: Terminal): void {
  terminals.set(sessionId, term);
}

export function unregisterTerminal(sessionId: string): void {
  terminals.delete(sessionId);
}

/** Returns a Promise that resolves after the next xterm.js render for the given session. */
export function waitForRender(sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const term = terminals.get(sessionId);
    if (!term) { resolve(); return; }
    const d = term.onRender(() => {
      d.dispose();
      resolve();
    });
  });
}

/** Check whether the terminal's active buffer is the alternate screen. */
export function isAltScreen(sessionId: string): boolean {
  const term = terminals.get(sessionId);
  if (!term) return false;
  return term.buffer.active.type === "alternate";
}
