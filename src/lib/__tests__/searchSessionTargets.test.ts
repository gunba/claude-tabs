import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_CONFIG, type Session } from "../../types/session";
import { buildJsonlSearchSessionTargets, searchableSessionScopeKey } from "../searchSessionTargets";

function session(overrides: Partial<Session>): Session {
  return {
    id: "app-session",
    name: "Session",
    config: {
      ...DEFAULT_SESSION_CONFIG,
      workingDir: "/repo",
      ...overrides.config,
    },
    state: "idle",
    metadata: {} as Session["metadata"],
    createdAt: "2026-05-07T00:00:00.000Z",
    lastActive: "2026-05-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("searchSessionTargets", () => {
  it("includes live Codex sessions before the rollout session id is known", () => {
    const targets = buildJsonlSearchSessionTargets([
      session({
        id: "codex-app",
        config: {
          ...DEFAULT_SESSION_CONFIG,
          cli: "codex",
          workingDir: "/repo",
          sessionId: null,
          resumeSession: null,
        },
      }),
    ]);

    expect(targets).toEqual([{
      appSessionId: "codex-app",
      sessionId: "codex-app",
      workingDir: "/repo",
      cli: "codex",
    }]);
  });

  it("requires a real CLI session id for live Claude sessions", () => {
    expect(buildJsonlSearchSessionTargets([
      session({
        id: "claude-app",
        config: {
          ...DEFAULT_SESSION_CONFIG,
          cli: "claude",
          workingDir: "/repo",
          sessionId: null,
        },
      }),
    ])).toEqual([]);
  });

  it("changes scope when Codex resume identity becomes available", () => {
    const before = searchableSessionScopeKey([
      session({
        id: "codex-app",
        config: { ...DEFAULT_SESSION_CONFIG, cli: "codex", workingDir: "/repo", resumeSession: null },
      }),
    ]);
    const after = searchableSessionScopeKey([
      session({
        id: "codex-app",
        config: { ...DEFAULT_SESSION_CONFIG, cli: "codex", workingDir: "/repo", resumeSession: "thread-1" },
      }),
    ]);

    expect(after).not.toBe(before);
  });
});
