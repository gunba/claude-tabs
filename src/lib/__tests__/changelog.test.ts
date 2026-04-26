import { describe, expect, it } from "vitest";
import { compareCliVersions, isCliVersionIncrease, normalizeCliVersion } from "../changelog";

describe("changelog version helpers", () => {
  it("normalizes CLI version strings", () => {
    expect(normalizeCliVersion("claude 2.1.119")).toBe("2.1.119");
    expect(normalizeCliVersion("codex-cli 0.126.0-alpha.2")).toBe("0.126.0-alpha.2");
    expect(normalizeCliVersion("no version")).toBeNull();
  });

  it("compares semantic versions with prefixes", () => {
    expect(compareCliVersions("Claude Code 2.1.119", "2.1.118")).toBe(1);
    expect(compareCliVersions("0.125.0", "codex-cli 0.126.0-alpha.1")).toBe(-1);
    expect(compareCliVersions("0.126.0", "0.126.0-alpha.2")).toBe(1);
    expect(compareCliVersions("0.126.0-alpha.10", "0.126.0-alpha.2")).toBe(1);
  });

  it("only treats strict increases as launch-worthy", () => {
    expect(isCliVersionIncrease("2.1.119", "2.1.118")).toBe(true);
    expect(isCliVersionIncrease("2.1.118", "2.1.118")).toBe(false);
    expect(isCliVersionIncrease("2.1.117", "2.1.118")).toBe(false);
  });
});
