import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_CONFIG, type Session, type Subagent } from "../../types/session";
import { buildTabStatusSpans } from "../tabStatusSpans";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session",
    name: "Session",
    config: {
      ...DEFAULT_SESSION_CONFIG,
      workingDir: "/repo",
      ...overrides.config,
    },
    state: "idle",
    metadata: {
      currentToolName: null,
      currentEventKind: null,
      runtimeModel: null,
      effortLevel: null,
      contextDebug: null,
      statusLine: null,
      ...overrides.metadata,
    } as Session["metadata"],
    createdAt: "2026-01-01T00:00:00Z",
    lastActive: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildTabStatusSpans", () => {
  it("renders model and effort spans", () => {
    const session = makeSession({
      config: {
        ...DEFAULT_SESSION_CONFIG,
        workingDir: "/repo",
        model: "claude-opus-4-6",
        effort: "high",
      },
    });

    expect(buildTabStatusSpans(session, []).map((span) => span.text)).toEqual([
      "Opus 4.6",
      "High",
    ]);
  });

  it("includes active subagent count and worktree acronym", () => {
    const session = makeSession({
      config: {
        ...DEFAULT_SESSION_CONFIG,
        workingDir: "/repo/.claude/worktrees/feature-one",
      },
    });
    const subagents = [
      { state: "thinking" },
      { state: "idle" },
    ] as Subagent[];

    const spans = buildTabStatusSpans(session, subagents);
    expect(spans.map((span) => span.text)).toContain("1 agent");
    expect(spans.find((span) => span.text === "FO")?.title).toBe("feature-one");
  });

  it("prefers status line context over contextDebug", () => {
    const session = makeSession({
      metadata: {
        statusLine: {
          currentInputTokens: 1200,
          cacheReadInputTokens: 300,
          cacheCreationInputTokens: 0,
        },
        contextDebug: {
          inputTokens: 10,
          cacheRead: 20,
          cacheCreation: 30,
          totalContextTokens: 60,
          model: null,
          source: "statusLine",
        },
      } as Session["metadata"],
    });

    const spans = buildTabStatusSpans(session, []);
    const lastSpan = spans[spans.length - 1];
    expect(lastSpan?.text).toBe("1.5K");
    expect(lastSpan?.title).toBe("Context: 1,200 input + 300 cache read + 0 cache write");
  });
});
