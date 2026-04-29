import { useSessionStore } from "../store/sessions";
import { dlog } from "../lib/debugLog";
import { normalizePath, parseWorktreePath } from "../lib/paths";
import type { TapEvent } from "../types/tapEvents";
import type { TapSubagentTracker } from "../lib/tapSubagentTracker";
import type { SessionConfig } from "../types/session";

type UpdateConfig = (id: string, patch: Partial<SessionConfig>) => void;

export function createTapWorktreeSync(sessionId: string, updateConfig: UpdateConfig) {
  const updateCwdIfChanged = (cwd: string, opts?: { fromWorktreeEvent?: boolean }) => {
    const normalized = normalizePath(cwd);
    const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
    if (!session || normalized === session.config.workingDir) return;
    // [SI-20] Anchor runtime cwd drift to launchWorkingDir. ConversationMessage and
    // SessionRegistration carry a cwd field that, in practice, can drift to a
    // sub-directory after plan-mode forks, subagent re-serialization, or other
    // transient states. Only accept drift when (a) it's an explicit worktree event,
    // (b) the new cwd matches launchWorkingDir, or (c) it parses as a worktree path
    // (covers user-initiated `claude -w` toggles).
    const launch = normalizePath(session.config.launchWorkingDir || session.config.workingDir);
    const isWorktreePath = parseWorktreePath(normalized) !== null;
    if (!opts?.fromWorktreeEvent && normalized !== launch && !isWorktreePath) {
      dlog("tap", sessionId, `cwd update rejected: ${normalized} != launch ${launch}`, "DEBUG");
      return;
    }
    updateConfig(sessionId, { workingDir: normalized });
  };

  const captureWorktreeExitCwd = (event: TapEvent): string | null => {
    if (event.kind !== "WorktreeCleared") return null;
    const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
    return session?.metadata?.worktreeInfo?.originalCwd || null;
  };

  const shouldSuppressSubagentWorktreeEvent = (
    event: TapEvent,
    subTracker: TapSubagentTracker,
  ): boolean =>
    (event.kind === "WorktreeState" || event.kind === "WorktreeCleared")
    && subTracker.isSubagentInFlight();

  const handleEvent = (
    event: TapEvent,
    subTracker: TapSubagentTracker,
    worktreeExitCwd: string | null,
    suppressSubagentWorktreeEvent: boolean,
  ): void => {
    // [SI-20] Worktree cwd detection: SessionRegistration gated behind isSubagentInFlight
    if (event.kind === "ConversationMessage" && event.cwd && !event.isSidechain) {
      if (!subTracker.isSubagentInFlight()) {
        updateCwdIfChanged(event.cwd);
      } else {
        dlog("tap", sessionId, `ConversationMessage cwd(${event.cwd}) suppressed — subagent in flight`, "DEBUG");
      }
    }
    if (event.kind === "SessionRegistration" && event.cwd) {
      if (!subTracker.isSubagentInFlight()) {
        updateCwdIfChanged(event.cwd);
      } else {
        dlog("tap", sessionId, `SessionRegistration cwd(${event.cwd}) suppressed — subagent in flight`, "DEBUG");
      }
    }
    if (event.kind === "CodexTurnContext" && event.cwd) {
      updateCwdIfChanged(event.cwd);
    }
    // WorktreeState: authoritative worktree path from CLI
    if (event.kind === "WorktreeState" && event.worktreePath) {
      if (!suppressSubagentWorktreeEvent) {
        updateCwdIfChanged(event.worktreePath, { fromWorktreeEvent: true });
      }
    }
    // WorktreeCleared: restore original working directory
    if (event.kind === "WorktreeCleared" && worktreeExitCwd) {
      if (!suppressSubagentWorktreeEvent) {
        updateCwdIfChanged(worktreeExitCwd, { fromWorktreeEvent: true });
      }
    }
  };

  return {
    captureWorktreeExitCwd,
    handleEvent,
    shouldSuppressSubagentWorktreeEvent,
  };
}
