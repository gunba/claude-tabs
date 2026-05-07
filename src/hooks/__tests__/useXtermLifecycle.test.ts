import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_CONFIG, type Session } from "../../types/session";
import { normalizeTerminalTitle, shouldApplyTerminalTitle } from "../useXtermLifecycle";

function session(cli: Session["config"]["cli"], name = "code_tabs"): Pick<Session, "config" | "name"> {
  return {
    name,
    config: {
      ...DEFAULT_SESSION_CONFIG,
      cli,
    },
  };
}

describe("terminal title renaming", () => {
  it("normalizes spinner-prefixed titles", () => {
    expect(normalizeTerminalTitle("⠋ code_tabs")).toBe("code_tabs");
  });

  it("ignores Codex OSC titles so folder names do not overwrite autorename", () => {
    expect(shouldApplyTerminalTitle(session("codex", "Fix Codex rename"), "code_tabs")).toBe(false);
  });

  it("allows non-default Claude titles", () => {
    expect(shouldApplyTerminalTitle(session("claude", "code_tabs"), "Review fixes")).toBe(true);
  });

  it("ignores Claude placeholder titles and unchanged names", () => {
    expect(shouldApplyTerminalTitle(session("claude"), "Claude Code")).toBe(false);
    expect(shouldApplyTerminalTitle(session("claude", "Review fixes"), "Review fixes")).toBe(false);
  });
});
