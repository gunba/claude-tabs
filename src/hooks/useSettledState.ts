import { useEffect, useState } from "react";
import { settledStateManager, type SettledKind } from "../lib/settledState";

/** Reactive hook returning the current settled kind for a session (null = not settled). */
export function useSettledState(sessionId: string | null): SettledKind | null {
  const [kind, setKind] = useState<SettledKind | null>(
    sessionId ? settledStateManager.getSettled(sessionId) : null,
  );

  useEffect(() => {
    if (!sessionId) { setKind(null); return; }

    // Sync with current state on mount / sessionId change
    setKind(settledStateManager.getSettled(sessionId));

    return settledStateManager.subscribe(
      (sid, k) => { if (sid === sessionId) setKind(k); },
      (sid) => { if (sid === sessionId) setKind(null); },
    );
  }, [sessionId]);

  return kind;
}
