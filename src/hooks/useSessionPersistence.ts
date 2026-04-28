import { useEffect } from "react";
import type { Session } from "../types/session";
import { flushDebugLog } from "../lib/debugLog";
import { killAllActivePtys } from "../lib/ptyProcess";

export function useSessionPersistence({
  sessions,
  persist,
}: {
  sessions: Session[];
  persist: () => Promise<void>;
}): void {
  // [PS-03] Debounced auto-persist every 2s on session array changes.
  useEffect(() => {
    if (sessions.length === 0) return;
    const timer = setTimeout(() => persist(), 2000);
    return () => clearTimeout(timer);
  }, [sessions, persist]);

  // [PS-02] [PS-04] beforeunload: kill all active PTY trees + flush persist.
  useEffect(() => {
    const handler = () => {
      killAllActivePtys();
      void flushDebugLog();
      persist();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [persist]);
}
