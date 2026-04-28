import type { SessionState } from "../types/session";

export interface TabCycleSession {
  id: string;
  state: SessionState;
  isMetaAgent?: boolean;
}

export function cycleTabId(
  sessions: readonly TabCycleSession[],
  activeTabId: string | null,
  direction: "next" | "previous",
): string | null {
  const pool = sessions.filter((s) => !s.isMetaAgent && s.state !== "dead");
  if (pool.length === 0) return null;

  const idx = activeTabId ? pool.findIndex((s) => s.id === activeTabId) : -1;
  if (idx < 0) {
    return direction === "previous" ? pool[pool.length - 1].id : pool[0].id;
  }

  const delta = direction === "previous" ? -1 : 1;
  return pool[(idx + delta + pool.length) % pool.length].id;
}

export function jumpTabId(
  sessions: readonly TabCycleSession[],
  oneBasedIndex: number,
): string | null {
  if (!Number.isInteger(oneBasedIndex) || oneBasedIndex < 1) return null;
  const nonMeta = sessions.filter((s) => !s.isMetaAgent);
  return nonMeta[oneBasedIndex - 1]?.id ?? null;
}
