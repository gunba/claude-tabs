/**
 * Global registry mapping session IDs to terminal buffer extraction functions.
 * Used by command palette "Copy Transcript" and export features.
 */

const bufferReaders = new Map<string, () => string>();

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
