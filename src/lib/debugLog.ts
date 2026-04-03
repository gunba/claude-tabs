// [DP-03] Structured debug logging — single entry point for all app logging via dlog()
// Zero imports to avoid circular dependencies. Session color lookup happens in the DebugPanel.

export type LogLevel = "DEBUG" | "LOG" | "WARN" | "ERR";

export interface DebugLogEntry {
  ts: number; // Date.now()
  level: LogLevel;
  module: string; // "pty", "inspector", "terminal", etc.
  sessionId: string | null; // null = global/system log
  message: string;
}

const MAX_ENTRIES = 5000; // [DP-04] Ring buffer: 5000 entries, oldest evicted first
const buffer: DebugLogEntry[] = [];
let generation = 0; // Increments on every push; lets poll detect changes when buffer is full
(globalThis as Record<string, unknown>).__debugLogEntries = buffer;

/** Structured debug log. Pushes to the structured buffer and forwards to console. */
export function dlog(
  module: string,
  sessionId: string | null,
  message: string,
  level: LogLevel = "LOG",
): void {
  buffer.push({ ts: Date.now(), level, module, sessionId, message });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  generation++;

  const fmt = `[${module}] ${message}`;
  if (level === "WARN") console.warn(fmt);
  else if (level === "ERR") console.error(fmt);
  else console.log(fmt);
}

/** Clear the structured buffer (used by DebugPanel clear action). */
export function clearDebugLog(): void {
  buffer.length = 0;
}

/** Read the structured buffer (used by DebugPanel polling). */
export function getDebugLog(): DebugLogEntry[] {
  return buffer;
}

/** Current generation (increments on every push). */
export function getDebugLogGeneration(): number {
  return generation;
}
