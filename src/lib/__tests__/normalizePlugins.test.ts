import { describe, it, expect } from "vitest";
import { normalizePlugins } from "../../components/ConfigManager/PluginsPane";

describe("normalizePlugins", () => {
  // Null/undefined/falsy inputs
  it("returns empty object for null", () => {
    expect(normalizePlugins(null)).toEqual({});
  });

  it("returns empty object for undefined", () => {
    expect(normalizePlugins(undefined)).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(normalizePlugins("")).toEqual({});
  });

  it("returns empty object for zero", () => {
    expect(normalizePlugins(0)).toEqual({});
  });

  it("returns empty object for false", () => {
    expect(normalizePlugins(false)).toEqual({});
  });

  // Array inputs
  it("converts string array to object with all true", () => {
    expect(normalizePlugins(["pluginA", "pluginB"])).toEqual({
      pluginA: true,
      pluginB: true,
    });
  });

  it("converts empty array to empty object", () => {
    expect(normalizePlugins([])).toEqual({});
  });

  it("ignores non-string array elements", () => {
    expect(normalizePlugins(["valid", 42, null, "also-valid"])).toEqual({
      valid: true,
      "also-valid": true,
    });
  });

  it("handles single-element array", () => {
    expect(normalizePlugins(["solo"])).toEqual({ solo: true });
  });

  // Object inputs
  it("passes through object with boolean values", () => {
    const input = { pluginA: true, pluginB: false };
    const result = normalizePlugins(input);
    expect(result).toEqual({ pluginA: true, pluginB: false });
  });

  it("only treats true as enabled, non-boolean values become false", () => {
    const input = { a: "yes", b: 1, c: null, d: undefined };
    const result = normalizePlugins(input);
    expect(result.a).toBe(false);
    expect(result.b).toBe(false);
    expect(result.c).toBe(false);
    expect(result.d).toBe(false);
  });

  it("only treats explicit true as true", () => {
    const input = { enabled: true, disabled: false, zero: 0 };
    const result = normalizePlugins(input);
    expect(result.enabled).toBe(true);
    expect(result.disabled).toBe(false);
    expect(result.zero).toBe(false);
  });

  it("converts empty object to empty object", () => {
    expect(normalizePlugins({})).toEqual({});
  });

  // Non-matching types
  it("returns empty object for number", () => {
    expect(normalizePlugins(42)).toEqual({});
  });

  it("returns empty object for non-empty string", () => {
    expect(normalizePlugins("not-valid")).toEqual({});
  });

  it("returns empty object for boolean true", () => {
    expect(normalizePlugins(true)).toEqual({});
  });

  // Idempotency
  it("is idempotent when applied to its own output", () => {
    const input = ["a", "b", "c"];
    const first = normalizePlugins(input);
    const second = normalizePlugins(first);
    expect(second).toEqual(first);
  });
});
