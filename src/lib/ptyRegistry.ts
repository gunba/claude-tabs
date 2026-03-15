/**
 * Global PTY writer registry.
 *
 * TerminalPanel registers its PTY write function on mount and
 * unregisters on unmount. This enables routing text input to the
 * correct session's terminal by session ID.
 */

const ptyWriters = new Map<string, (data: string) => void>();

/** Register a PTY write function for a session. */
export function registerPtyWriter(sessionId: string, write: (data: string) => void): void {
  ptyWriters.set(sessionId, write);
}

/** Unregister a PTY write function when a session is cleaned up. */
export function unregisterPtyWriter(sessionId: string): void {
  ptyWriters.delete(sessionId);
}

/** Write data to a session's PTY. Returns true if the writer was found. */
export function writeToPty(sessionId: string, data: string): boolean {
  const write = ptyWriters.get(sessionId);
  if (write) { write(data); return true; }
  return false;
}
