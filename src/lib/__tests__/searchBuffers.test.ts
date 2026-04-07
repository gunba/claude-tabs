import { describe, it, expect } from "vitest";
import { validateRegex } from "../searchBuffers";

// ── validateRegex ────────────────────────────────────────────────

describe("validateRegex", () => {
  it("returns null for valid pattern", () => {
    expect(validateRegex("hel+o")).toBeNull();
  });

  it("returns error message for invalid pattern", () => {
    const err = validateRegex("[invalid(");
    expect(err).toBeTypeOf("string");
    expect(err!.length).toBeGreaterThan(0);
  });

  it("returns null for empty pattern", () => {
    expect(validateRegex("")).toBeNull();
  });
});
