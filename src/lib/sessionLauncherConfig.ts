import type { SessionConfig } from "../types/session";
import { DEFAULT_SESSION_CONFIG } from "../types/session";
import { normalizePath, parseWorktreePath } from "./paths";

export function workspaceDefaultsKey(workingDir: string): string {
  const wt = parseWorktreePath(workingDir);
  return normalizePath(wt ? wt.projectRoot : workingDir).toLowerCase();
}

export function clearOneShotLauncherFields(config: SessionConfig): SessionConfig {
  if (!config.resumeSession && !config.forkSession && !config.continueSession) return config;
  return {
    ...config,
    resumeSession: null,
    forkSession: false,
    continueSession: false,
  };
}

/** One-shot migration for Codex sessions saved before the Codex-native
 *  Sandbox + Approval dropdowns existed. Translates the legacy Claude-shaped
 *  permissionMode into the new Codex axes and clears permissionMode so the
 *  next launch reads from the new fields. Idempotent: no-op when either
 *  Codex field is already set, or when cli is not "codex". */
function migrateCodexPerms(cfg: SessionConfig): SessionConfig {
  if (cfg.cli !== "codex") return cfg;
  if (cfg.codexSandboxMode != null || cfg.codexApprovalPolicy != null) return cfg;

  const next = { ...cfg };
  switch (cfg.permissionMode) {
    case "planMode":
      next.codexSandboxMode = "read-only";
      next.codexApprovalPolicy = "untrusted";
      next.permissionMode = "default";
      break;
    case "acceptEdits":
    case "dontAsk":
      next.codexSandboxMode = "workspace-write";
      next.codexApprovalPolicy = "never";
      next.permissionMode = "default";
      break;
    case "bypassPermissions":
      next.dangerouslySkipPermissions = true;
      next.permissionMode = "default";
      break;
    case "auto":
      // Codex schema marks `on-failure` (the half of --full-auto we'd
      // re-emit) as DEPRECATED. Land on Codex defaults and let the user
      // pick explicitly from the dropdowns.
      next.permissionMode = "default";
      break;
    case "default":
    default:
      // Nothing to migrate.
      break;
  }
  return next;
}

// [SL-09] Restore launcher config while preserving fork intent for resume configs.
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

  const merged: SessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    ...defaults,
    ...(wsDefaults ?? {}),
    workingDir: defaults.workingDir,
    continueSession: false,
    sessionId: null,
    runMode: false,
    forkSession: resumeLaunch ? defaults.forkSession : false,
  };

  return migrateCodexPerms(merged);
}

export function buildWorkspaceLauncherConfig(params: {
  workingDir: string;
  /** Modal's current in-flight selection; preserved when the workspace has no saved defaults. */
  currentConfig: SessionConfig;
  workspaceDefaults: Record<string, Partial<SessionConfig>>;
}): SessionConfig {
  const wsKey = workspaceDefaultsKey(params.workingDir);
  const wsDefaults = wsKey ? params.workspaceDefaults[wsKey] : undefined;

  // Preserve the user's in-modal selections (model, cli, effort, permission
  // settings, etc.) by default. Workspace defaults override only when the user
  // explicitly saved them for this folder — switching to a folder with no
  // history must not snap the model dropdown back to a global default.
  const merged: SessionConfig = {
    ...params.currentConfig,
    ...(wsDefaults ?? {}),
    workingDir: params.workingDir,
    resumeSession: null,
    continueSession: false,
    sessionId: null,
    runMode: false,
    forkSession: false,
  };

  return migrateCodexPerms(merged);
}

export function buildFinalLauncherConfig(
  launchConfig: SessionConfig,
  isNonSessionCommand: boolean,
): SessionConfig {
  return isNonSessionCommand
    ? {
        ...launchConfig,
        runMode: true,
        model: null,
        permissionMode: "default",
        effort: null,
        dangerouslySkipPermissions: false,
        projectDir: false,
      }
    : {
        ...launchConfig,
        launchWorkingDir: launchConfig.workingDir,
        runMode: false,
      };
}
