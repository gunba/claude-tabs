import { describe, expect, it } from "vitest";
import {
  BEACH_GLYPHS,
  beachGlyph,
  clampCol,
  hash32,
  makeSlotInit,
  withAlpha,
} from "../HeaderActivityViz";

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
  it("is deterministic for the same id", () => {
    const a = makeSlotInit("session-x");
    const b = makeSlotInit("session-x");
    expect(a).toEqual(b);
  });

  it("produces values inside the documented ranges", () => {
    for (const id of ["a", "session-1", "session::sub", "x".repeat(64)]) {
      const init = makeSlotInit(id);
      expect(init.homeCol).toBeGreaterThanOrEqual(1);
      expect(init.homeCol).toBeLessThan(7); // 1 + r1 * (BEACH_COLS-2) where BEACH_COLS=8
      expect(init.homeRow).toBeGreaterThanOrEqual(0);
      expect(init.homeRow).toBeLessThan(1);
      expect(init.speed).toBeGreaterThanOrEqual(5);
      expect(init.speed).toBeLessThan(9);
      expect(init.jitterSeed).toBeGreaterThanOrEqual(0);
      expect(init.jitterSeed).toBeLessThan(Math.PI * 2);
    }
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

describe("beachGlyph", () => {
  it("returns one of the registered glyphs", () => {
    const valid = new Set(BEACH_GLYPHS.map((g) => g.ch));
    for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 6; row++) {
        const g = beachGlyph(col, row);
        expect(valid.has(g.ch)).toBe(true);
        expect(typeof g.light).toBe("boolean");
      }
    }
  });

  it("is deterministic for the same (col, row)", () => {
    expect(beachGlyph(2, 4)).toEqual(beachGlyph(2, 4));
    expect(beachGlyph(0, 0)).toEqual(beachGlyph(0, 0));
  });

  it("varies across positions", () => {
    const seen = new Set<string>();
    for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 6; row++) seen.add(beachGlyph(col, row).ch);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("clampCol", () => {
  it("floors fractional cols", () => {
    expect(clampCol(3.9, 10)).toBe(3);
    expect(clampCol(0.1, 10)).toBe(0);
  });

  it("clamps to [0, cols-1]", () => {
    expect(clampCol(-5, 10)).toBe(0);
    expect(clampCol(99, 10)).toBe(9);
    expect(clampCol(10, 10)).toBe(9);
  });
});
