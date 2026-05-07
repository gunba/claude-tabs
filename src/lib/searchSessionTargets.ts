import type { Session } from "../types/session";

export interface JsonlSearchSessionTarget {
  appSessionId: string;
  sessionId: string;
  workingDir: string;
  cli: Session["config"]["cli"];
}

export function searchableSessionScopeKey(sessions: Session[]): string {
  return sessions
    .filter((s) => !s.isMetaAgent)
    .map((s) => `${s.id}\0${s.config.cli}\0${s.config.sessionId ?? ""}\0${s.config.resumeSession ?? ""}\0${s.config.workingDir ?? ""}`)
    .join("\u0001");
}

export function buildJsonlSearchSessionTargets(sessions: Session[]): JsonlSearchSessionTarget[] {
  return sessions
    .filter((s) =>
      !s.isMetaAgent
      && s.state !== "dead"
      && !!s.config.workingDir
      && (s.config.cli === "codex" || !!s.config.sessionId)
    )
    .map((s) => ({
      appSessionId: s.id,
      sessionId: s.config.sessionId || s.config.resumeSession || s.id,
      workingDir: s.config.workingDir,
      cli: s.config.cli,
    }));
}
