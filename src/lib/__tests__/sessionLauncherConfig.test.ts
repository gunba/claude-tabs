import { describe, expect, it } from "vitest";
import { buildInitialLauncherConfig } from "../sessionLauncherConfig";
import { DEFAULT_SESSION_CONFIG, type SessionConfig } from "../../types/session";

function config(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    ...DEFAULT_SESSION_CONFIG,
    workingDir: "/projects/myapp",
    ...overrides,
  };
}

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

  it("applies workspace defaults for fresh launches", () => {
    const result = buildInitialLauncherConfig({
      lastConfig: config({ cli: "claude", model: "sonnet", resumeSession: null }),
      savedDefaults: null,
      workspaceDefaults: {
        "/projects/myapp": {
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
});
