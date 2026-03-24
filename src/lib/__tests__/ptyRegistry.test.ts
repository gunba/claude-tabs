import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerPtyWriter, unregisterPtyWriter, writeToPty, registerPtyKill, unregisterPtyKill, killPty } from "../ptyRegistry";

describe("ptyRegistry", () => {
  const SESSION_ID = "test-session-1";

  beforeEach(() => {
    unregisterPtyWriter(SESSION_ID);
    unregisterPtyWriter("test-session-2");
    unregisterPtyKill(SESSION_ID);
    unregisterPtyKill("test-session-2");
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

  it("writeToPty returns true and calls writer for registered session", () => {
    const writeFn = vi.fn();
    registerPtyWriter(SESSION_ID, writeFn);
    const result = writeToPty(SESSION_ID, "hello\r");
    expect(result).toBe(true);
    expect(writeFn).toHaveBeenCalledWith("hello\r");
  });

  it("writeToPty returns false for unregistered session", () => {
    const result = writeToPty("nonexistent", "hello");
    expect(result).toBe(false);
  });

  it("writeToPty returns false after unregistering", () => {
    const writeFn = vi.fn();
    registerPtyWriter(SESSION_ID, writeFn);
    unregisterPtyWriter(SESSION_ID);
    const result = writeToPty(SESSION_ID, "hello");
    expect(result).toBe(false);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it("killPty calls registered kill function and awaits it", async () => {
    const killFn = vi.fn().mockResolvedValue(undefined);
    registerPtyKill(SESSION_ID, killFn);
    await killPty(SESSION_ID);
    expect(killFn).toHaveBeenCalledOnce();
  });

  it("killPty is a no-op for unregistered session", async () => {
    await expect(killPty("nonexistent")).resolves.toBeUndefined();
  });

  it("killPty is a no-op after unregistering", async () => {
    const killFn = vi.fn().mockResolvedValue(undefined);
    registerPtyKill(SESSION_ID, killFn);
    unregisterPtyKill(SESSION_ID);
    await killPty(SESSION_ID);
    expect(killFn).not.toHaveBeenCalled();
  });
});
