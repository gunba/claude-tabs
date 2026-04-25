import type { SessionConfig } from "../types/session";
import { DEFAULT_SESSION_CONFIG } from "../types/session";
import { normalizePath, parseWorktreePath } from "./paths";

export function workspaceDefaultsKey(workingDir: string): string {
  const wt = parseWorktreePath(workingDir);
  return normalizePath(wt ? wt.projectRoot : workingDir).toLowerCase();
}

export function buildInitialLauncherConfig(params: {
  lastConfig: SessionConfig;
  savedDefaults: SessionConfig | null;
  workspaceDefaults: Record<string, Partial<SessionConfig>>;
}): SessionConfig {
  const resumeLaunch = !!params.lastConfig.resumeSession;
  const defaults = resumeLaunch
    ? params.lastConfig
    : (params.savedDefaults ?? params.lastConfig);
  const wsKey = workspaceDefaultsKey(defaults.workingDir);
  const wsDefaults = !resumeLaunch && wsKey
    ? params.workspaceDefaults[wsKey]
    : undefined;

  return {
    ...DEFAULT_SESSION_CONFIG,
    ...defaults,
    ...(wsDefaults ?? {}),
    workingDir: defaults.workingDir,
    continueSession: false,
    sessionId: null,
    runMode: false,
    forkSession: false,
  };
}
