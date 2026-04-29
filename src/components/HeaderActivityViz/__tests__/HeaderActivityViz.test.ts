import { describe, expect, it } from "vitest";
import { clampPx, hash32, makeSlotInit, withAlpha } from "../HeaderActivityViz";

describe("hash32", () => {
  it("is deterministic for the same input", () => {
    expect(hash32("session-abc")).toBe(hash32("session-abc"));
    expect(hash32("")).toBe(hash32(""));
  });

  it("produces different values for different inputs", () => {
    expect(hash32("a")).not.toBe(hash32("b"));
    expect(hash32("session-1")).not.toBe(hash32("session-2"));
  });

  it("returns a non-negative integer", () => {
    for (const s of ["", "a", "session::sub", "🦀", "long-".repeat(200)]) {
      const h = hash32(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(h)).toBe(true);
    }
  });
});

describe("makeSlotInit", () => {
  it("is deterministic for the same id and beachW", () => {
    const a = makeSlotInit("session-x", 110);
    const b = makeSlotInit("session-x", 110);
    expect(a).toEqual(b);
  });

  it("produces values inside the documented ranges", () => {
    const beachW = 110;
    for (const id of ["a", "session-1", "session::sub", "x".repeat(64)]) {
      const init = makeSlotInit(id, beachW);
      // homeXPx sits within the padded beach band (padding = 4px each side).
      expect(init.homeXPx).toBeGreaterThanOrEqual(4);
      expect(init.homeXPx).toBeLessThanOrEqual(beachW - 4);
      expect(init.homeRow01).toBeGreaterThanOrEqual(0);
      expect(init.homeRow01).toBeLessThan(1);
      // speed in 28..50 px/s
      expect(init.speedPxPerS).toBeGreaterThanOrEqual(28);
      expect(init.speedPxPerS).toBeLessThan(50);
      expect(init.jitterSeed).toBeGreaterThanOrEqual(0);
      expect(init.jitterSeed).toBeLessThan(Math.PI * 2);
    }
  });

  it("scales home position with beachW", () => {
    const small = makeSlotInit("same-id", 40);
    const large = makeSlotInit("same-id", 200);
    // Same hash → same r1 fraction → wider beach gives a wider home.
    expect(large.homeXPx).toBeGreaterThan(small.homeXPx);
  });
});

describe("withAlpha", () => {
  it("expands 6-digit hex into rgba", () => {
    expect(withAlpha("#d4744a", 0.5)).toBe("rgba(212, 116, 74, 0.500)");
  });

  it("expands 3-digit hex into rgba", () => {
    expect(withAlpha("#abc", 1)).toBe("rgba(170, 187, 204, 1.000)");
  });

  it("trims whitespace before parsing", () => {
    expect(withAlpha("  #d4744a  ", 0.25)).toBe("rgba(212, 116, 74, 0.250)");
  });

  it("passes non-hex colors through unchanged", () => {
    expect(withAlpha("rgb(1, 2, 3)", 0.5)).toBe("rgb(1, 2, 3)");
    expect(withAlpha("red", 0.5)).toBe("red");
  });
});

describe("clampPx", () => {
  it("clamps to [0, max]", () => {
    expect(clampPx(-5, 100)).toBe(0);
    expect(clampPx(150, 100)).toBe(100);
    expect(clampPx(50, 100)).toBe(50);
  });

  it("returns the value when in range", () => {
    expect(clampPx(0, 100)).toBe(0);
    expect(clampPx(100, 100)).toBe(100);
    expect(clampPx(0.5, 100)).toBe(0.5);
  });
});
