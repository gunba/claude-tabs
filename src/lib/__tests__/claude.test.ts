import { describe, it, expect } from "vitest";
import { dirToTabName, modelLabel, formatTokenCount } from "../claude";

describe("dirToTabName", () => {
  it("extracts last path segment (Unix)", () => {
    expect(dirToTabName("/home/user/projects/my-app")).toBe("my-app");
  });

  it("extracts last path segment (Windows)", () => {
    expect(dirToTabName("C:\\Users\\jorda\\Desktop\\my-project")).toBe("my-project");
  });

  it("handles trailing slash", () => {
    expect(dirToTabName("/home/user/code/")).toBe("code");
  });

  it("returns full string when no separators", () => {
    expect(dirToTabName("my-project")).toBe("my-project");
  });
});

describe("modelLabel", () => {
  it("returns Default for null", () => {
    expect(modelLabel(null)).toBe("Default");
  });

  it("returns Opus for opus model", () => {
    expect(modelLabel("claude-opus-4-6")).toBe("Opus");
  });

  it("returns Sonnet for sonnet model", () => {
    expect(modelLabel("claude-sonnet-4-6")).toBe("Sonnet");
  });

  it("returns Haiku for haiku model", () => {
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku");
  });

  it("returns raw model string for unknown models", () => {
    expect(modelLabel("custom-model-v1")).toBe("custom-model-v1");
  });
});

describe("formatTokenCount", () => {
  it("returns raw number for small values", () => {
    expect(formatTokenCount(42)).toBe("42");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("returns <1 for zero", () => {
    expect(formatTokenCount(0)).toBe("<1");
  });

  it("formats thousands with one decimal for 1K-9.9K", () => {
    expect(formatTokenCount(1500)).toBe("1.5K");
    expect(formatTokenCount(2300)).toBe("2.3K");
    expect(formatTokenCount(9999)).toBe("10.0K");
  });

  it("formats thousands rounded for 10K+", () => {
    expect(formatTokenCount(10000)).toBe("10K");
    expect(formatTokenCount(36000)).toBe("36K");
    expect(formatTokenCount(999999)).toBe("1000K");
  });

  it("formats millions with one decimal", () => {
    expect(formatTokenCount(1200000)).toBe("1.2M");
    expect(formatTokenCount(5000000)).toBe("5.0M");
  });
});
