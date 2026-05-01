import { describe, it, expect } from "vitest";
import {
  normalizePath,
  abbreviatePath,
  computeGroupReorder,
  computeTabReorder,
  formatScopePath,
  groupSessionsByDir,
  parseWorktreePath,
  sideFromMidpoint,
  worktreeAcronym,
  dirToTabName,
  parentDir,
  splitFilePath,
  IS_WINDOWS,
} from "../paths";
// TabGroup type used implicitly via groupSessionsByDir return
import { scopePath } from "../../components/ConfigManager/ThreePaneEditor";
import type { TabId } from "../../components/ConfigManager/ThreePaneEditor";

// ── normalizePath ───────────────────────────────────────────────

describe("normalizePath", () => {
  it("handles empty string", () => {
    expect(normalizePath("")).toBe("");
  });

  describe.runIf(IS_WINDOWS)("Windows", () => {
    it("converts forward slashes to backslashes", () => {
      expect(normalizePath("C:/Users/jorda/code")).toBe("C:\\Users\\jorda\\code");
    });

    it("strips trailing backslash", () => {
      expect(normalizePath("C:\\Users\\jorda\\")).toBe("C:\\Users\\jorda");
    });

    it("strips multiple trailing backslashes", () => {
      expect(normalizePath("C:\\Users\\jorda\\\\")).toBe("C:\\Users\\jorda");
    });

    it("handles already-normalized path", () => {
      expect(normalizePath("C:\\Users\\jorda")).toBe("C:\\Users\\jorda");
    });
  });

  describe.runIf(!IS_WINDOWS)("Linux", () => {
    it("preserves forward slashes", () => {
      expect(normalizePath("/home/user/code")).toBe("/home/user/code");
    });

    it("strips trailing forward slash", () => {
      expect(normalizePath("/home/user/code/")).toBe("/home/user/code");
    });

    it("strips multiple trailing forward slashes", () => {
      expect(normalizePath("/home/user/code//")).toBe("/home/user/code");
    });

    it("handles already-clean path", () => {
      expect(normalizePath("/home/user/code")).toBe("/home/user/code");
    });

    it("does not convert backslashes to forward slashes", () => {
      expect(normalizePath("/home/user/my\\dir")).toBe("/home/user/my\\dir");
    });
  });
});

// ── abbreviatePath ──────────────────────────────────────────────

describe("abbreviatePath", () => {
  it("keeps last two components for long paths", () => {
    expect(abbreviatePath("C:/Users/jorda/Projects/my-app")).toBe("~/Projects/my-app");
  });

  it("handles backslash paths", () => {
    expect(abbreviatePath("C:\\Users\\jorda\\Desktop\\project")).toBe("~/Desktop/project");
  });

  it("returns full path when only two components", () => {
    expect(abbreviatePath("C:/code")).toBe("C:/code");
  });

  it("returns full path when one component", () => {
    expect(abbreviatePath("code")).toBe("code");
  });

  it("handles trailing slashes (filtered by split)", () => {
    expect(abbreviatePath("C:/Users/jorda/code/")).toBe("~/jorda/code");
  });

  it("handles deeply nested paths", () => {
    expect(abbreviatePath("C:/Users/jorda/Projects/work/client/app")).toBe("~/client/app");
  });
});

// ── formatScopePath ─────────────────────────────────────────────

describe("formatScopePath", () => {
  it("passes through user-scope paths (~/...) unchanged", () => {
    expect(formatScopePath("~/.claude/settings.json")).toBe("~/.claude/settings.json");
  });

  it("passes through ~/... paths with deeper nesting", () => {
    expect(formatScopePath("~/.claude/agents/")).toBe("~/.claude/agents/");
  });

  it("abbreviates project-scope paths with long directory prefix", () => {
    // dir portion = "C:/Users/jorda/Projects/my-app/.claude", file = "/settings.json"
    // abbreviatePath keeps last 2 dir components: "~/my-app/.claude"
    expect(formatScopePath("C:\\Users\\jorda\\Projects\\my-app/.claude/settings.json"))
      .toBe("~/my-app/.claude/settings.json");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(formatScopePath("C:\\Users\\jorda\\code\\CLAUDE.md"))
      .toBe("~/jorda/code/CLAUDE.md");
  });

  it("handles short paths (two or fewer components) without abbreviation", () => {
    expect(formatScopePath("project/CLAUDE.md")).toBe("project/CLAUDE.md");
  });

  it("handles single-segment path", () => {
    expect(formatScopePath("CLAUDE.md")).toBe("CLAUDE.md");
  });

  it("handles root-level slash only", () => {
    expect(formatScopePath("/")).toBe("/");
  });

  it("handles empty string", () => {
    expect(formatScopePath("")).toBe("");
  });
});

// ── scopePath (ThreePaneEditor) ─────────────────────────────────

describe("scopePath", () => {
  const dir = "C:\\Users\\jorda\\Projects\\my-app";

  describe("settings/hooks/plugins tabs share settings.json paths", () => {
    const settingsTabs: TabId[] = ["settings", "hooks", "plugins"];

    for (const tabId of settingsTabs) {
      it(`${tabId}: user scope`, () => {
        expect(scopePath("user", dir, tabId)).toBe("~/.claude/settings.json");
      });

      it(`${tabId}: project scope`, () => {
        expect(scopePath("project", dir, tabId)).toBe(`${dir}/.claude/settings.json`);
      });

      it(`${tabId}: project-local scope`, () => {
        expect(scopePath("project-local", dir, tabId)).toBe(`${dir}/.claude/settings.local.json`);
      });
    }
  });

  describe("claudemd tab", () => {
    it("user scope", () => {
      expect(scopePath("user", dir, "claudemd")).toBe("~/.claude/CLAUDE.md");
    });

    it("project scope — CLAUDE.md at project root", () => {
      expect(scopePath("project", dir, "claudemd")).toBe(`${dir}/CLAUDE.md`);
    });

    it("project-local scope — CLAUDE.local.md at project root", () => {
      expect(scopePath("project-local", dir, "claudemd")).toBe(`${dir}/CLAUDE.local.md`);
    });
  });

  describe("agents tab", () => {
    it("user scope", () => {
      expect(scopePath("user", dir, "agents")).toBe("~/.claude/agents/");
    });

    it("project scope", () => {
      expect(scopePath("project", dir, "agents")).toBe(`${dir}/.claude/agents/`);
    });
  });

  describe("skills tab", () => {
    it("user scope", () => {
      expect(scopePath("user", dir, "skills")).toBe("~/.claude/{commands,skills}/");
    });

    it("project scope", () => {
      expect(scopePath("project", dir, "skills")).toBe(`${dir}/.claude/{commands,skills}/`);
    });
  });

  describe("codex paths", () => {
    it("settings/hooks/mcp use config.toml", () => {
      expect(scopePath("user", dir, "settings", "codex")).toBe("~/.codex/config.toml");
      expect(scopePath("project", dir, "hooks", "codex")).toBe(`${dir}/.codex/config.toml`);
      expect(scopePath("project", dir, "mcp", "codex")).toBe(`${dir}/.codex/config.toml`);
    });

    it("instructions use AGENTS.md", () => {
      expect(scopePath("user", dir, "claudemd", "codex")).toBe("~/.codex/AGENTS.md");
      expect(scopePath("project", dir, "claudemd", "codex")).toBe(`${dir}/AGENTS.md`);
      expect(scopePath("project-local", dir, "claudemd", "codex")).toBe(`${dir}/AGENTS.local.md`);
    });

    it("skills use .agents skills directories", () => {
      expect(scopePath("user", dir, "skills", "codex")).toBe("~/.agents/skills/");
      expect(scopePath("project", dir, "skills", "codex")).toBe(`${dir}/.agents/skills/`);
    });
  });

  describe("empty dir fallback", () => {
    it("falls back to '.' when dir is empty", () => {
      expect(scopePath("project", "", "settings")).toBe("./.claude/settings.json");
    });

    it("falls back to '.' for claudemd", () => {
      expect(scopePath("project", "", "claudemd")).toBe("./CLAUDE.md");
    });

    it("falls back to '.' for agents", () => {
      expect(scopePath("project", "", "agents")).toBe("./.claude/agents/");
    });
  });
});

// ── parseWorktreePath ──────────────────────────────────────────

describe("parseWorktreePath", () => {
  it("detects a worktree path with backslashes", () => {
    const result = parseWorktreePath("C:\\Users\\jorda\\Projects\\code_tabs\\.claude\\worktrees\\sorted-marinating-dove");
    expect(result).toEqual({
      projectName: "code_tabs",
      worktreeName: "sorted-marinating-dove",
      projectRoot: "C:/Users/jorda/Projects/code_tabs",
    });
  });

  it("detects a worktree path with forward slashes", () => {
    const result = parseWorktreePath("C:/Users/jorda/Projects/my-app/.claude/worktrees/fix-bug");
    expect(result).toEqual({
      projectName: "my-app",
      worktreeName: "fix-bug",
      projectRoot: "C:/Users/jorda/Projects/my-app",
    });
  });

  it("detects the code-tabs-owned worktree directory", () => {
    const result = parseWorktreePath("C:/Users/jorda/Projects/my-app/.code_tabs/worktrees/fix-bug");
    expect(result).toEqual({
      projectName: "my-app",
      worktreeName: "fix-bug",
      projectRoot: "C:/Users/jorda/Projects/my-app",
    });
  });

  it("handles trailing slash", () => {
    const result = parseWorktreePath("C:/code/proj/.claude/worktrees/wt1/");
    expect(result).toEqual({
      projectName: "proj",
      worktreeName: "wt1",
      projectRoot: "C:/code/proj",
    });
  });

  it("returns null for non-worktree path", () => {
    expect(parseWorktreePath("C:\\Users\\jorda\\Projects\\code_tabs")).toBeNull();
  });

  it("returns null for path containing .claude but not worktrees", () => {
    expect(parseWorktreePath("C:/code/proj/.claude/settings.json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseWorktreePath("")).toBeNull();
  });

  it("returns null for root-level .claude path (no project parent)", () => {
    expect(parseWorktreePath("/.claude/worktrees/wt1")).toBeNull();
  });
});

// ── worktreeAcronym ────────────────────────────────────────────

describe("worktreeAcronym", () => {
  it("creates acronym from hyphen-separated words", () => {
    expect(worktreeAcronym("sorted-marinating-dove")).toBe("SMD");
  });

  it("handles single word", () => {
    expect(worktreeAcronym("hotfix")).toBe("H");
  });

  it("handles two words", () => {
    expect(worktreeAcronym("fix-bug")).toBe("FB");
  });

  it("drops empty segments from consecutive hyphens", () => {
    expect(worktreeAcronym("a--b")).toBe("AB");
  });

  it("drops leading hyphen empty segment", () => {
    expect(worktreeAcronym("-foo")).toBe("F");
  });
});

// ── dirToTabName (worktree) ────────────────────────────────────

describe("dirToTabName", () => {
  it("returns project name for worktree path", () => {
    expect(dirToTabName("C:\\Users\\jorda\\Projects\\code_tabs\\.claude\\worktrees\\sorted-marinating-dove")).toBe("code_tabs");
  });

  it("returns last component for non-worktree path", () => {
    expect(dirToTabName("C:\\Users\\jorda\\Projects\\code_tabs")).toBe("code_tabs");
  });

  it("returns empty string for empty input", () => {
    expect(dirToTabName("")).toBe("");
  });
});

// ── parentDir ─────────────────────────────────────────────────

describe("parentDir", () => {
  it("returns parent of a forward-slash path", () => {
    expect(parentDir("C:/Users/jorda/.claude/projects/proj/abc.jsonl"))
      .toBe("C:/Users/jorda/.claude/projects/proj");
  });

  it("returns parent of a backslash path (preserves native separators)", () => {
    expect(parentDir("C:\\Users\\jorda\\.claude\\projects\\proj\\abc.jsonl"))
      .toBe("C:\\Users\\jorda\\.claude\\projects\\proj");
  });

  it("returns path unchanged when no separator found", () => {
    expect(parentDir("file.jsonl")).toBe("file.jsonl");
  });

  it("handles mixed separators", () => {
    expect(parentDir("C:\\Users/jorda/.claude\\proj\\abc.jsonl"))
      .toBe("C:\\Users/jorda/.claude\\proj");
  });

  it("returns path unchanged for root-level file", () => {
    expect(parentDir("/file.jsonl")).toBe("/file.jsonl");
  });

  it("returns empty string unchanged", () => {
    expect(parentDir("")).toBe("");
  });
});

// ── splitFilePath ─────────────────────────────────────────────

describe("splitFilePath", () => {
  it("splits a forward-slash path", () => {
    expect(splitFilePath("src/lib/app.ts")).toEqual({ dir: "src/lib/", name: "app.ts" });
  });

  it("handles bare filenames", () => {
    expect(splitFilePath("app.ts")).toEqual({ dir: "", name: "app.ts" });
  });

  it("preserves backslash separators", () => {
    expect(splitFilePath("src\\lib\\app.ts")).toEqual({ dir: "src\\lib\\", name: "app.ts" });
  });
});

// ── Test helpers ────────────────────────────────────────────────

import type { Session } from "../../types/session";
import { DEFAULT_SESSION_CONFIG } from "../../types/session";

function mkSession(id: string, workingDir: string): Session {
  return {
    id,
    name: id,
    config: { ...DEFAULT_SESSION_CONFIG, workingDir },
    state: "idle",
    metadata: { costUsd: 0, contextDebug: null, durationSecs: 0, currentAction: null, nodeSummary: null, currentToolName: null, currentEventKind: null, inputTokens: 0, outputTokens: 0, assistantMessageCount: 0, choiceHint: false, runtimeModel: null, apiRegion: null, lastRequestId: null, subscriptionType: null, hookStatus: null, lastTurnCostUsd: 0, lastTurnTtftMs: 0, systemPromptLength: 0, toolCount: 0, conversationLength: 0, activeSubprocess: null, filesTouched: [], rateLimitRemaining: null, rateLimitReset: null, fiveHourPercent: null, fiveHourResetsAt: null, sevenDayPercent: null, sevenDayResetsAt: null, apiLatencyMs: 0, pingRttMs: 0, serverTimeMs: 0, tokPerSec: 0, linesAdded: 0, linesRemoved: 0, lastToolDurationMs: null, lastToolResultSize: null, lastToolError: null, apiRetryCount: 0, apiErrorStatus: null, apiRetryInfo: null, stallDurationMs: 0, stallCount: 0, contextBudget: null, hookTelemetry: null, planOutcome: null, effortLevel: null, worktreeInfo: null, capturedSystemPrompt: null, statusLine: null },
    createdAt: "",
    lastActive: "",
  };
}

// ── groupSessionsByDir ─────────────────────────────────────────

describe("groupSessionsByDir", () => {
  it("groups sessions with identical workingDir", () => {
    const sessions = [
      mkSession("a", "C:\\code\\proj"),
      mkSession("b", "C:\\code\\proj"),
      mkSession("c", "C:\\other"),
    ];
    const groups = groupSessionsByDir(sessions);
    expect(groups).toHaveLength(2);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["c"]);
  });

  it.runIf(IS_WINDOWS)("normalizes mixed slash styles into same group (Windows)", () => {
    const sessions = [
      mkSession("a", "C:/code/proj"),
      mkSession("b", "C:\\code\\proj"),
    ];
    const groups = groupSessionsByDir(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(2);
  });

  it("preserves relative order within groups", () => {
    const sessions = [
      mkSession("a1", "C:\\alpha"),
      mkSession("b1", "C:\\beta"),
      mkSession("a2", "C:\\alpha"),
      mkSession("b2", "C:\\beta"),
      mkSession("a3", "C:\\alpha"),
    ];
    const groups = groupSessionsByDir(sessions);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a1", "a2", "a3"]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["b1", "b2"]);
  });

  it("orders groups by first occurrence", () => {
    const sessions = [
      mkSession("b1", "C:\\beta"),
      mkSession("a1", "C:\\alpha"),
      mkSession("b2", "C:\\beta"),
    ];
    const groups = groupSessionsByDir(sessions);
    expect(groups[0].key).toBe("C:\\beta");
    expect(groups[1].key).toBe("C:\\alpha");
  });

  it("returns empty array for empty input", () => {
    expect(groupSessionsByDir([])).toEqual([]);
  });

  it("creates single-session groups", () => {
    const sessions = [mkSession("a", "C:\\one"), mkSession("b", "C:\\two")];
    const groups = groupSessionsByDir(sessions);
    expect(groups).toHaveLength(2);
    expect(groups[0].sessions).toHaveLength(1);
    expect(groups[1].sessions).toHaveLength(1);
  });

  it("sets label from dirToTabName", () => {
    const groups = groupSessionsByDir([mkSession("a", "C:\\Users\\jorda\\my-project")]);
    expect(groups[0].label).toBe("my-project");
  });

  it("sets fullPath to original workingDir", () => {
    const groups = groupSessionsByDir([mkSession("a", "C:/foo/bar")]);
    expect(groups[0].fullPath).toBe("C:/foo/bar");
  });

  it("groups sessions with empty workingDir together", () => {
    const sessions = [
      mkSession("a", ""),
      mkSession("b", ""),
      mkSession("c", "C:\\code"),
    ];
    const groups = groupSessionsByDir(sessions);
    expect(groups).toHaveLength(2);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(groups[0].key).toBe("");
  });

  it("merges trailing-slash variant into same group", () => {
    const sessions = IS_WINDOWS
      ? [mkSession("a", "C:\\code\\proj\\"), mkSession("b", "C:\\code\\proj")]
      : [mkSession("a", "/code/proj/"), mkSession("b", "/code/proj")];
    const groups = groupSessionsByDir(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(2);
  });

  it("treats different cases as separate groups (case-sensitive)", () => {
    // normalizePath does not lowercase; Windows paths differ by case
    const sessions = [
      mkSession("a", "C:\\Code"),
      mkSession("b", "C:\\code"),
    ];
    const groups = groupSessionsByDir(sessions);
    expect(groups).toHaveLength(2);
  });

  it.runIf(IS_WINDOWS)("uses first session's workingDir for fullPath when variants differ (Windows)", () => {
    // Forward-slash variant appears first; fullPath preserves that original form
    const sessions = [
      mkSession("a", "C:/code/proj"),
      mkSession("b", "C:\\code\\proj"),
    ];
    const groups = groupSessionsByDir(sessions);
    expect(groups[0].fullPath).toBe("C:/code/proj");
  });

  it("handles single session with empty workingDir", () => {
    const groups = groupSessionsByDir([mkSession("x", "")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("");
    expect(groups[0].label).toBe("");
    expect(groups[0].fullPath).toBe("");
  });

  it("groups worktree sessions with their project root", () => {
    const sessions = IS_WINDOWS
      ? [
          mkSession("root", "C:\\Users\\jorda\\PycharmProjects\\code_tabs"),
          mkSession("wt1", "C:\\Users\\jorda\\PycharmProjects\\code_tabs\\.claude\\worktrees\\gentle-wandering-dongarra"),
          mkSession("wt2", "C:\\Users\\jorda\\PycharmProjects\\code_tabs\\.claude\\worktrees\\sorted-marinating-dove"),
        ]
      : [
          mkSession("root", "/home/jordan/PycharmProjects/code_tabs"),
          mkSession("wt1", "/home/jordan/PycharmProjects/code_tabs/.claude/worktrees/gentle-wandering-dongarra"),
          mkSession("wt2", "/home/jordan/PycharmProjects/code_tabs/.claude/worktrees/sorted-marinating-dove"),
        ];
    const groups = groupSessionsByDir(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["root", "wt1", "wt2"]);
    expect(groups[0].label).toBe("code_tabs");
    expect(groups[0].key).toBe(
      IS_WINDOWS
        ? "C:\\Users\\jorda\\PycharmProjects\\code_tabs"
        : "/home/jordan/PycharmProjects/code_tabs",
    );
  });
});

// ── sideFromMidpoint ───────────────────────────────────────────

describe("sideFromMidpoint", () => {
  it("returns 'before' when cursor is left of midpoint", () => {
    expect(sideFromMidpoint(10, { left: 0, width: 100 })).toBe("before");
  });

  it("returns 'after' when cursor is right of midpoint", () => {
    expect(sideFromMidpoint(60, { left: 0, width: 100 })).toBe("after");
  });

  it("returns 'after' at exact midpoint (strict <)", () => {
    expect(sideFromMidpoint(50, { left: 0, width: 100 })).toBe("after");
  });

  it("respects non-zero left offset", () => {
    expect(sideFromMidpoint(120, { left: 100, width: 100 })).toBe("before");
    expect(sideFromMidpoint(160, { left: 100, width: 100 })).toBe("after");
  });
});

// ── computeTabReorder ──────────────────────────────────────────

describe("computeTabReorder", () => {
  const sessions = [
    mkSession("a1", "C:\\alpha"),
    mkSession("a2", "C:\\alpha"),
    mkSession("a3", "C:\\alpha"),
    mkSession("b1", "C:\\beta"),
  ];
  const groups = groupSessionsByDir(sessions);
  const order = ["a1", "a2", "a3", "b1"];

  it("moves first to after second", () => {
    expect(computeTabReorder(order, "a1", "a2", "after", groups))
      .toEqual(["a2", "a1", "a3", "b1"]);
  });

  it("moves first to before third", () => {
    expect(computeTabReorder(order, "a1", "a3", "before", groups))
      .toEqual(["a2", "a1", "a3", "b1"]);
  });

  it("moves last (within-group) to before first (within-group)", () => {
    expect(computeTabReorder(order, "a3", "a1", "before", groups))
      .toEqual(["a3", "a1", "a2", "b1"]);
  });

  it("moves middle tab right", () => {
    expect(computeTabReorder(order, "a2", "a3", "after", groups))
      .toEqual(["a1", "a3", "a2", "b1"]);
  });

  it("returns null when source equals target", () => {
    expect(computeTabReorder(order, "a1", "a1", "before", groups)).toBeNull();
  });

  it("returns null when target is in a different group", () => {
    expect(computeTabReorder(order, "a1", "b1", "before", groups)).toBeNull();
    expect(computeTabReorder(order, "b1", "a1", "after", groups)).toBeNull();
  });

  it("returns null on adjacent no-op (already at that position)", () => {
    expect(computeTabReorder(order, "a1", "a2", "before", groups)).toBeNull();
    expect(computeTabReorder(order, "a2", "a1", "after", groups)).toBeNull();
  });

  it("returns null when source not in order", () => {
    expect(computeTabReorder(order, "missing", "a2", "before", groups)).toBeNull();
  });

  it("returns null when target not in order", () => {
    expect(computeTabReorder(order, "a1", "missing", "before", groups)).toBeNull();
  });

  it("does not mutate the input order", () => {
    const copy = [...order];
    computeTabReorder(order, "a1", "a3", "before", groups);
    expect(order).toEqual(copy);
  });
});

// ── computeGroupReorder ────────────────────────────────────────

describe("computeGroupReorder", () => {
  const sessions = [
    mkSession("a1", "C:\\alpha"),
    mkSession("a2", "C:\\alpha"),
    mkSession("b1", "C:\\beta"),
    mkSession("b2", "C:\\beta"),
    mkSession("c1", "C:\\gamma"),
  ];
  const groups = groupSessionsByDir(sessions);
  const aKey = groups[0].key;
  const bKey = groups[1].key;
  const cKey = groups[2].key;
  const order = ["a1", "a2", "b1", "b2", "c1"];

  it("moves group A to after group B", () => {
    expect(computeGroupReorder(order, aKey, bKey, "after", groups))
      .toEqual(["b1", "b2", "a1", "a2", "c1"]);
  });

  it("moves group C to before group A", () => {
    expect(computeGroupReorder(order, cKey, aKey, "before", groups))
      .toEqual(["c1", "a1", "a2", "b1", "b2"]);
  });

  it("moves group B to after group C", () => {
    expect(computeGroupReorder(order, bKey, cKey, "after", groups))
      .toEqual(["a1", "a2", "c1", "b1", "b2"]);
  });

  it("moves group C to after group A (between A and B)", () => {
    expect(computeGroupReorder(order, cKey, aKey, "after", groups))
      .toEqual(["a1", "a2", "c1", "b1", "b2"]);
  });

  it("returns null when source equals target", () => {
    expect(computeGroupReorder(order, aKey, aKey, "before", groups)).toBeNull();
  });

  it("returns null on adjacent no-op (group already at that position)", () => {
    // A is immediately before B → 'before B' is no-op for source A
    expect(computeGroupReorder(order, aKey, bKey, "before", groups)).toBeNull();
    // B is immediately after A → 'after A' is no-op for source B
    expect(computeGroupReorder(order, bKey, aKey, "after", groups)).toBeNull();
    // B is immediately before C → 'before C' is no-op for source B
    expect(computeGroupReorder(order, bKey, cKey, "before", groups)).toBeNull();
  });

  it("returns null when source group key is not found", () => {
    expect(computeGroupReorder(order, "missing", bKey, "before", groups)).toBeNull();
  });

  it("returns null when target group key is not found", () => {
    expect(computeGroupReorder(order, aKey, "missing", "before", groups)).toBeNull();
  });

  it("does not mutate the input order", () => {
    const copy = [...order];
    computeGroupReorder(order, aKey, bKey, "after", groups);
    expect(order).toEqual(copy);
  });
});
