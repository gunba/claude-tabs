import { describe, it, expect } from "vitest";
import { sessionFingerprint } from "../metaAgentUtils";

describe("sessionFingerprint", () => {
  it("returns empty string for empty sessions", () => {
    expect(sessionFingerprint([])).toBe("");
  });

  it("generates fingerprint from id:state pairs", () => {
    const sessions = [
      { id: "a", state: "idle" },
      { id: "b", state: "thinking" },
    ];
    const fp = sessionFingerprint(sessions);
    expect(fp).toContain("a:idle");
    expect(fp).toContain("b:thinking");
  });

  it("sorts fingerprint for deterministic output", () => {
    const sessions1 = [
      { id: "b", state: "idle" },
      { id: "a", state: "thinking" },
    ];
    const sessions2 = [
      { id: "a", state: "thinking" },
      { id: "b", state: "idle" },
    ];
    expect(sessionFingerprint(sessions1)).toBe(sessionFingerprint(sessions2));
  });

  it("filters out meta-agent sessions", () => {
    const sessions = [
      { id: "a", state: "idle", isMetaAgent: false },
      { id: "b", state: "thinking", isMetaAgent: true },
    ];
    const fp = sessionFingerprint(sessions);
    expect(fp).toContain("a:idle");
    expect(fp).not.toContain("b:thinking");
  });

  it("produces different fingerprints for different states", () => {
    const sessions1 = [{ id: "a", state: "idle" }];
    const sessions2 = [{ id: "a", state: "thinking" }];
    expect(sessionFingerprint(sessions1)).not.toBe(sessionFingerprint(sessions2));
  });
});
