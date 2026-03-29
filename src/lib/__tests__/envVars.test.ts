import { describe, it, expect } from "vitest";
import { groupEnvVars, CATEGORY_ORDER, CATEGORY_LABELS } from "../envVars";
import type { EnvVarEntry } from "../envVars";

const makeVar = (name: string, category: string, documented = true): EnvVarEntry => ({
  name,
  description: `Description for ${name}`,
  category,
  documented,
});

describe("groupEnvVars", () => {
  it("groups entries by category", () => {
    const vars: EnvVarEntry[] = [
      makeVar("ANTHROPIC_API_KEY", "api"),
      makeVar("ANTHROPIC_MODEL", "model"),
      makeVar("HTTP_PROXY", "network"),
    ];
    const groups = groupEnvVars(vars);
    expect(groups.get("api")).toHaveLength(1);
    expect(groups.get("model")).toHaveLength(1);
    expect(groups.get("network")).toHaveLength(1);
  });

  it("omits empty categories", () => {
    const vars: EnvVarEntry[] = [makeVar("ANTHROPIC_API_KEY", "api")];
    const groups = groupEnvVars(vars);
    expect(groups.has("model")).toBe(false);
    expect(groups.has("network")).toBe(false);
  });

  it("respects CATEGORY_ORDER for known categories", () => {
    const vars: EnvVarEntry[] = CATEGORY_ORDER.map((cat) => makeVar(`VAR_${cat}`, cat));
    const groups = groupEnvVars(vars);
    const keys = Array.from(groups.keys());
    // All known categories appear in the correct order
    const knownInOrder = CATEGORY_ORDER.filter((c) => groups.has(c));
    expect(keys.filter((k) => CATEGORY_ORDER.includes(k))).toEqual(knownInOrder);
  });

  it("places unknown categories in 'other'", () => {
    const vars: EnvVarEntry[] = [makeVar("CUSTOM_VAR", "custom-unknown-category", false)];
    const groups = groupEnvVars(vars);
    // Custom category goes into 'other'
    const otherVars = groups.get("other") ?? [];
    expect(otherVars.some((v) => v.name === "CUSTOM_VAR")).toBe(true);
  });

  it("places unknown category vars in 'other' even when other starts empty", () => {
    // Clarity: old code pushed to 'other' via mutation then redundantly re-set the same
    // reference. New code uses explicit key selection. Both produce the same result.
    const vars: EnvVarEntry[] = [
      makeVar("FIRST_UNKNOWN", "totally-unknown-cat", false),
      makeVar("SECOND_UNKNOWN", "another-unknown-cat", false),
    ];
    const groups = groupEnvVars(vars);
    const otherVars = groups.get("other") ?? [];
    expect(otherVars).toHaveLength(2);
    expect(otherVars.map((v) => v.name)).toContain("FIRST_UNKNOWN");
    expect(otherVars.map((v) => v.name)).toContain("SECOND_UNKNOWN");
  });

  it("returns empty map for empty input", () => {
    expect(groupEnvVars([]).size).toBe(0);
  });

  it("places a var explicitly categorized as 'other' in the other bucket", () => {
    const vars = [makeVar("MYSTERY_VAR", "other", false)];
    const groups = groupEnvVars(vars);
    expect(groups.get("other")).toHaveLength(1);
    expect(groups.get("other")![0].name).toBe("MYSTERY_VAR");
  });

  it("groups multiple vars in same category", () => {
    const vars: EnvVarEntry[] = [
      makeVar("A", "api"),
      makeVar("B", "api"),
      makeVar("C", "api"),
    ];
    const groups = groupEnvVars(vars);
    expect(groups.get("api")).toHaveLength(3);
  });
});

describe("CATEGORY_LABELS", () => {
  it("has a label for every category in CATEGORY_ORDER", () => {
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[cat]).toBeDefined();
      expect(CATEGORY_LABELS[cat].length).toBeGreaterThan(0);
    }
  });
});
