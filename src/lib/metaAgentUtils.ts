/**
 * Pure utility functions for the meta-agent system.
 * Separated from hooks to enable unit testing without Tauri dependencies.
 */

/** Compute a fingerprint of session states to detect meaningful changes */
export function sessionFingerprint(
  sessions: { id: string; state: string; isMetaAgent?: boolean }[]
): string {
  return sessions
    .filter((s) => !s.isMetaAgent)
    .map((s) => `${s.id}:${s.state}`)
    .sort()
    .join("|");
}
