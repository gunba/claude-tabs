import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerPtyWriter, unregisterPtyWriter } from "../ptyRegistry";

describe("ptyRegistry", () => {
  const SESSION_ID = "test-session-1";

  beforeEach(() => {
    unregisterPtyWriter(SESSION_ID);
    unregisterPtyWriter("test-session-2");
  });

  it("registers a writer without throwing", () => {
    const writeFn = vi.fn();
    expect(() => registerPtyWriter(SESSION_ID, writeFn)).not.toThrow();
  });

  it("unregistering a registered writer does not throw", () => {
    const writeFn = vi.fn();
    registerPtyWriter(SESSION_ID, writeFn);
    expect(() => unregisterPtyWriter(SESSION_ID)).not.toThrow();
  });

  it("unregistering a non-existent session does not throw", () => {
    expect(() => unregisterPtyWriter("nonexistent")).not.toThrow();
  });
});
