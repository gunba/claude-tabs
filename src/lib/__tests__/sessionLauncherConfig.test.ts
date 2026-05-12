import { describe, expect, it } from "vitest";
import {
  buildFinalLauncherConfig,
  buildInitialLauncherConfig,
  buildWorkspaceLauncherConfig,
  clearOneShotLauncherFields,
  workspaceDefaultsKey,
} from "../sessionLauncherConfig";
import { DEFAULT_SESSION_CONFIG, type SessionConfig } from "../../types/session";

function config(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    ...DEFAULT_SESSION_CONFIG,
    workingDir: "/projects/myapp",
    ...overrides,
  };
}

describe("clearOneShotLauncherFields", () => {
  it("clears stale resume, fork, and continue state for fresh launcher entry points", () => {
    const input = config({
      resumeSession: "stale-resume",
      forkSession: true,
      continueSession: true,
      sessionId: "current-session",
      runMode: true,
    });

    const result = clearOneShotLauncherFields(input);

    expect(result).not.toBe(input);
    expect(result.resumeSession).toBeNull();
    expect(result.forkSession).toBe(false);
    expect(result.continueSession).toBe(false);
    expect(result.sessionId).toBe("current-session");
    expect(result.runMode).toBe(true);
  });

  it("preserves object identity when no one-shot launcher fields are present", () => {
    const input = config({
      resumeSession: null,
      forkSession: false,
      continueSession: false,
    });

    expect(clearOneShotLauncherFields(input)).toBe(input);
  });
});

describe("buildInitialLauncherConfig", () => {
  it("does not apply workspace defaults when opening a resume config", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({
        cli: "codex",
        model: "gpt-5.5",
        effort: "high",
        dangerouslySkipPermissions: false,
        resumeSession: "019dc57d-b78a-75c3-b087-32d7446ebe85",
      }),
      savedDefaults: null,
      workspaceDefaults: {
        "/projects/myapp": {
          cli: "claude",
          model: "sonnet",
          effort: "max",
          dangerouslySkipPermissions: true,
        },
      },
    });

    expect(result.cli).toBe("codex");
    expect(result.model).toBe("gpt-5.5");
    expect(result.effort).toBe("high");
    expect(result.dangerouslySkipPermissions).toBe(false);
    expect(result.resumeSession).toBe("019dc57d-b78a-75c3-b087-32d7446ebe85");
  });

  it("preserves fork intent when opening a resume config", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({
        resumeSession: "019dc57d-b78a-75c3-b087-32d7446ebe85",
        forkSession: true,
        continueSession: true,
        sessionId: "stale",
        runMode: true,
      }),
      savedDefaults: null,
      workspaceDefaults: {},
    });

    expect(result.resumeSession).toBe("019dc57d-b78a-75c3-b087-32d7446ebe85");
    expect(result.forkSession).toBe(true);
    expect(result.continueSession).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.runMode).toBe(false);
  });

  it("applies workspace defaults for fresh launches", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({ cli: "claude", model: "sonnet", resumeSession: null }),
      savedDefaults: null,
      workspaceDefaults: {
        [workspaceDefaultsKey("/projects/myapp")]: {
          cli: "codex",
          model: "gpt-5.5",
          effort: "medium",
        },
      },
    });

    expect(result.cli).toBe("codex");
    expect(result.model).toBe("gpt-5.5");
    expect(result.effort).toBe("medium");
  });

  it("clears one-shot launch fields on initialization", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({
        continueSession: true,
        sessionId: "sid",
        runMode: true,
        forkSession: true,
      }),
      savedDefaults: null,
      workspaceDefaults: {},
    });

    expect(result.continueSession).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.runMode).toBe(false);
    expect(result.forkSession).toBe(false);
  });

  it("defaults Codex sandbox/approval to null on a fresh config", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({ cli: "claude" }),
      savedDefaults: null,
      workspaceDefaults: {},
    });

    expect(result.codexSandboxMode).toBeNull();
    expect(result.codexApprovalPolicy).toBeNull();
  });

  it("migrates legacy Codex permissionMode=planMode to read-only + untrusted", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({
        cli: "codex",
        permissionMode: "planMode",
        codexSandboxMode: null,
        codexApprovalPolicy: null,
      }),
      savedDefaults: null,
      workspaceDefaults: {},
    });

    expect(result.codexSandboxMode).toBe("read-only");
    expect(result.codexApprovalPolicy).toBe("untrusted");
    // permissionMode reset so we don't re-migrate next time and so the
    // Claude pill row (if the user switches CLI) starts clean.
    expect(result.permissionMode).toBe("default");
  });

  it("migrates legacy Codex permissionMode=acceptEdits to workspace-write + never", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({
        cli: "codex",
        permissionMode: "acceptEdits",
        codexSandboxMode: null,
        codexApprovalPolicy: null,
      }),
      savedDefaults: null,
      workspaceDefaults: {},
    });

    expect(result.codexSandboxMode).toBe("workspace-write");
    expect(result.codexApprovalPolicy).toBe("never");
    expect(result.permissionMode).toBe("default");
  });

  it("migrates legacy Codex permissionMode=bypassPermissions to dangerouslySkipPermissions", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({
        cli: "codex",
        permissionMode: "bypassPermissions",
        codexSandboxMode: null,
        codexApprovalPolicy: null,
      }),
      savedDefaults: null,
      workspaceDefaults: {},
    });

    expect(result.dangerouslySkipPermissions).toBe(true);
    expect(result.codexSandboxMode).toBeNull();
    expect(result.codexApprovalPolicy).toBeNull();
    expect(result.permissionMode).toBe("default");
  });

  it("does not re-migrate when Codex fields are already set", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({
        cli: "codex",
        permissionMode: "planMode", // would otherwise migrate to read-only/untrusted
        codexSandboxMode: "workspace-write",
        codexApprovalPolicy: "on-request",
      }),
      savedDefaults: null,
      workspaceDefaults: {},
    });

    expect(result.codexSandboxMode).toBe("workspace-write");
    expect(result.codexApprovalPolicy).toBe("on-request");
    // permissionMode passes through untouched in the no-op path.
    expect(result.permissionMode).toBe("planMode");
  });

  it("does not migrate when cli is claude", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({
        cli: "claude",
        permissionMode: "planMode",
      }),
      savedDefaults: null,
      workspaceDefaults: {},
    });

    expect(result.permissionMode).toBe("planMode");
    expect(result.codexSandboxMode).toBeNull();
    expect(result.codexApprovalPolicy).toBeNull();
  });
});

describe("buildWorkspaceLauncherConfig", () => {
  it("applies workspace defaults over the modal's current selection when present", () => {
    const result = buildWorkspaceLauncherConfig({
      workingDir: "/projects/other",
      currentConfig: config({
        cli: "claude",
        model: "opus",
        effort: "high",
        resumeSession: "one-shot",
        runMode: true,
      }),
      workspaceDefaults: {
        [workspaceDefaultsKey("/projects/other")]: {
          cli: "codex",
          model: "gpt-5.5",
          effort: "medium",
        },
      },
    });

    expect(result.workingDir).toBe("/projects/other");
    expect(result.cli).toBe("codex");
    expect(result.model).toBe("gpt-5.5");
    expect(result.effort).toBe("medium");
    expect(result.resumeSession).toBeNull();
    expect(result.runMode).toBe(false);
  });

  it("preserves the modal's current selection when the workspace has no saved defaults", () => {
    const result = buildWorkspaceLauncherConfig({
      workingDir: "/projects/other",
      currentConfig: config({
        cli: "claude",
        model: "opus",
        effort: "high",
      }),
      workspaceDefaults: {},
    });

    expect(result.workingDir).toBe("/projects/other");
    expect(result.cli).toBe("claude");
    expect(result.model).toBe("opus");
    expect(result.effort).toBe("high");
  });

  it("clears one-shot fields and updates workingDir even when preserving in-modal selection", () => {
    const result = buildWorkspaceLauncherConfig({
      workingDir: "/projects/other",
      currentConfig: config({
        cli: "codex",
        model: "gpt-5",
        resumeSession: "stale",
        continueSession: true,
        sessionId: "sid",
        runMode: true,
        forkSession: true,
      }),
      workspaceDefaults: {},
    });

    expect(result.workingDir).toBe("/projects/other");
    expect(result.resumeSession).toBeNull();
    expect(result.continueSession).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.runMode).toBe(false);
    expect(result.forkSession).toBe(false);
  });
});

describe("buildFinalLauncherConfig", () => {
  it("stamps launchWorkingDir from workingDir for fresh session launches", () => {
    const result = buildFinalLauncherConfig(
      config({
        workingDir: "/projects/ato-mcp",
        launchWorkingDir: "/projects",
        runMode: true,
        resumeSession: null,
        forkSession: false,
      }),
      false,
    );

    expect(result.workingDir).toBe("/projects/ato-mcp");
    expect(result.launchWorkingDir).toBe("/projects/ato-mcp");
    expect(result.runMode).toBe(false);
  });

  it("stamps launchWorkingDir for resume launches while preserving resume identity", () => {
    const result = buildFinalLauncherConfig(
      config({
        workingDir: "/projects/ato-mcp",
        launchWorkingDir: "/projects",
        resumeSession: "019dc57d-b78a-75c3-b087-32d7446ebe85",
        forkSession: false,
      }),
      false,
    );

    expect(result.launchWorkingDir).toBe("/projects/ato-mcp");
    expect(result.resumeSession).toBe("019dc57d-b78a-75c3-b087-32d7446ebe85");
    expect(result.forkSession).toBe(false);
  });

  it("stamps launchWorkingDir for fork launches while preserving fork intent", () => {
    const result = buildFinalLauncherConfig(
      config({
        workingDir: "/projects/ato-mcp",
        launchWorkingDir: "/projects",
        resumeSession: "019dc57d-b78a-75c3-b087-32d7446ebe85",
        forkSession: true,
      }),
      false,
    );

    expect(result.launchWorkingDir).toBe("/projects/ato-mcp");
    expect(result.resumeSession).toBe("019dc57d-b78a-75c3-b087-32d7446ebe85");
    expect(result.forkSession).toBe(true);
  });

  it("normalizes utility commands without stamping session launchWorkingDir", () => {
    const result = buildFinalLauncherConfig(
      config({
        workingDir: "/projects/ato-mcp",
        launchWorkingDir: "/projects",
        model: "gpt-5",
        permissionMode: "bypassPermissions",
        effort: "high",
        dangerouslySkipPermissions: true,
        projectDir: true,
      }),
      true,
    );

    expect(result.runMode).toBe(true);
    expect(result.model).toBeNull();
    expect(result.permissionMode).toBe("default");
    expect(result.effort).toBeNull();
    expect(result.dangerouslySkipPermissions).toBe(false);
    expect(result.projectDir).toBe(false);
    expect(result.launchWorkingDir).toBe("/projects");
  });
});
