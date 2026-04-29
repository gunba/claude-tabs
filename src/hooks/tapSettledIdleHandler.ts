import { useActivityStore } from "../store/activity";
import { settledStateManager } from "../lib/settledState";
import { runGitScanAndValidate, runPathExistenceValidation } from "./tapActivityTracker";

export function subscribeTapSettledIdleHandler(
  sessionId: string,
  onIdle: () => void,
): () => void {
  // [AS-03] End activity turns on settled-idle — still needed for
  // the UI's Response mode boundary and stats recomputation.
  // After endTurn, scan git for external changes (covers Bash mutations and
  // out-of-process edits we couldn't see) then validate every path against
  // the filesystem to drop false positives.
  const unsubSettled = settledStateManager.subscribe(
    (settledSid, kind) => {
      if (settledSid === sessionId && kind === "idle") {
        onIdle();
        void runGitScanAndValidate(sessionId);
      }
    },
    () => {},
  );

  // Throttled paths_exist on every activity store change so heuristic
  // false positives (Bash parser, apply_patch, errored Read inputs) are
  // dropped within ~1.5s instead of waiting for settled-idle hysteresis.
  let pendingValidate: ReturnType<typeof setTimeout> | null = null;
  let lastValidate = 0;
  const VALIDATE_THROTTLE_MS = 1500;
  const scheduleValidation = () => {
    if (pendingValidate) return;
    const delayMs = Math.max(lastValidate + VALIDATE_THROTTLE_MS - Date.now(), 0);
    pendingValidate = setTimeout(() => {
      pendingValidate = null;
      lastValidate = Date.now();
      void runPathExistenceValidation(sessionId);
    }, delayMs);
  };
  let prevActivity = useActivityStore.getState().sessions[sessionId];
  const unsubActivity = useActivityStore.subscribe((state) => {
    const next = state.sessions[sessionId];
    if (next !== prevActivity) {
      prevActivity = next;
      scheduleValidation();
    }
  });

  return () => {
    unsubSettled();
    unsubActivity();
    if (pendingValidate) clearTimeout(pendingValidate);
  };
}
