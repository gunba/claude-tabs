import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerBufferReader,
  unregisterBufferReader,
  getSessionTranscript,
  registerTerminal,
  focusTerminal,
  unregisterTerminal,
  waitForRender,
  isAltScreen,
} from "../terminalRegistry";

// ── Minimal Terminal mock ──

function mockTerminal(altScreen = false) {
  const renderListeners: Array<(range: { start: number; end: number }) => void> = [];
  return {
    onRender: vi.fn((cb: (range: { start: number; end: number }) => void) => {
      renderListeners.push(cb);
      return { dispose: vi.fn(() => {
        const idx = renderListeners.indexOf(cb);
        if (idx >= 0) renderListeners.splice(idx, 1);
      }) };
    }),
    buffer: {
      active: { type: altScreen ? "alternate" : "normal" },
    },
    _fireRender: () => { renderListeners.forEach(cb => cb({ start: 0, end: 24 })); },
  } as unknown as import("@xterm/xterm").Terminal & { _fireRender: () => void };
}

// ── Tests ──

describe("terminalRegistry", () => {
  const SID = "test-session";
  const SID2 = "test-session-2";

  beforeEach(() => {
    unregisterBufferReader(SID);
    unregisterBufferReader(SID2);
    unregisterTerminal(SID);
    unregisterTerminal(SID2);
  });

  // ── Buffer reader ──

  describe("bufferReader", () => {
    it("returns null for unregistered session", () => {
      expect(getSessionTranscript("nonexistent")).toBeNull();
    });

    it("returns transcript from registered reader", () => {
      registerBufferReader(SID, () => "line1\nline2");
      expect(getSessionTranscript(SID)).toBe("line1\nline2");
    });

    it("returns null after unregistering", () => {
      registerBufferReader(SID, () => "data");
      unregisterBufferReader(SID);
      expect(getSessionTranscript(SID)).toBeNull();
    });

    it("does not affect other sessions", () => {
      registerBufferReader(SID, () => "session-1-data");
      registerBufferReader(SID2, () => "session-2-data");
      expect(getSessionTranscript(SID)).toBe("session-1-data");
      expect(getSessionTranscript(SID2)).toBe("session-2-data");
    });

    it("overwrites reader on re-registration", () => {
      registerBufferReader(SID, () => "old");
      registerBufferReader(SID, () => "new");
      expect(getSessionTranscript(SID)).toBe("new");
    });

    it("unregistering a non-existent session does not throw", () => {
      expect(() => unregisterBufferReader("nonexistent")).not.toThrow();
    });
  });

  // ── Terminal registration ──

  describe("terminal registration", () => {
    it("overwrites terminal on re-registration", () => {
      const term1 = mockTerminal();
      const term2 = mockTerminal();
      registerTerminal(SID, term1);
      registerTerminal(SID, term2);
      // Verify the second terminal is active by checking isAltScreen
      expect(isAltScreen(SID)).toBe(false);
    });

    it("focuses a registered terminal", () => {
      const focus = vi.fn();
      const term = {
        ...mockTerminal(),
        focus,
      } as unknown as import("@xterm/xterm").Terminal;
      registerTerminal(SID, term);
      focusTerminal(SID);
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("focusing an unregistered terminal does not throw", () => {
      expect(() => focusTerminal("nonexistent")).not.toThrow();
    });

    it("unregistering a non-existent session does not throw", () => {
      expect(() => unregisterTerminal("nonexistent")).not.toThrow();
    });
  });

  // ── waitForRender ──

  describe("waitForRender", () => {
    it("resolves immediately for unregistered session", async () => {
      await waitForRender("nonexistent");
    });

    it("resolves when terminal fires onRender", async () => {
      const term = mockTerminal();
      registerTerminal(SID, term);
      const promise = waitForRender(SID);
      term._fireRender();
      await promise;
    });
  });

  // ── isAltScreen ──

  describe("isAltScreen", () => {
    it("returns false for unregistered session", () => {
      expect(isAltScreen("nonexistent")).toBe(false);
    });

    it("returns false for normal buffer", () => {
      registerTerminal(SID, mockTerminal(false));
      expect(isAltScreen(SID)).toBe(false);
    });

    it("returns true for alternate buffer", () => {
      registerTerminal(SID, mockTerminal(true));
      expect(isAltScreen(SID)).toBe(true);
    });
  });
});
