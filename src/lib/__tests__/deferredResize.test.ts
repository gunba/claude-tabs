import { describe, it, expect, vi } from "vitest";

/**
 * Tests for deferred PTY resize logic [TR-15] [BF-01].
 *
 * The actual logic lives in TerminalPanel.tsx's handleResize callback,
 * which defers PTY resize when bgBuffer has pending data. These tests
 * validate the decision logic and flush behavior as pure functions,
 * extracted from the ref-based component patterns.
 */

// ── Decision logic: should resize be deferred? ──────────────────────

/**
 * Mirrors the deferred resize decision in TerminalPanel.handleResize.
 * Returns true if the resize should be deferred (bgBuffer non-empty).
 */
function shouldDeferResize(bgBufferLength: number): boolean {
  return bgBufferLength > 0;
}

/**
 * Mirrors the flush-then-resize sequence in TerminalPanel's visibility effect.
 * Returns the actions that should occur when a tab becomes visible.
 */
function flushAndResize(
  bgBuffer: Uint8Array[],
  deferredResize: { cols: number; rows: number } | null
): { mergedBuffer: Uint8Array | null; resize: { cols: number; rows: number } | null } {
  let mergedBuffer: Uint8Array | null = null;

  if (bgBuffer.length > 0) {
    let totalLen = 0;
    for (const c of bgBuffer) totalLen += c.length;
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of bgBuffer) { merged.set(c, offset); offset += c.length; }
    mergedBuffer = merged;
  }

  return { mergedBuffer, resize: deferredResize };
}

describe("deferred PTY resize decision", () => {
  it("defers resize when bgBuffer has data", () => {
    expect(shouldDeferResize(3)).toBe(true);
    expect(shouldDeferResize(1)).toBe(true);
    expect(shouldDeferResize(100)).toBe(true);
  });

  it("does NOT defer resize when bgBuffer is empty", () => {
    expect(shouldDeferResize(0)).toBe(false);
  });
});

describe("deferred resize: handleResize simulation", () => {
  it("records deferred resize and skips PTY call when bgBuffer non-empty", () => {
    const resizeFn = vi.fn();
    let deferredResize: { cols: number; rows: number } | null = null;
    const bgBufferLength = 5; // non-empty

    // Simulate handleResize logic
    const cols = 120;
    const rows = 40;
    if (shouldDeferResize(bgBufferLength)) {
      deferredResize = { cols, rows };
    } else {
      resizeFn(cols, rows);
    }

    expect(deferredResize).toEqual({ cols: 120, rows: 40 });
    expect(resizeFn).not.toHaveBeenCalled();
  });

  it("sends resize immediately when bgBuffer is empty", () => {
    const resizeFn = vi.fn();
    let deferredResize: { cols: number; rows: number } | null = null;
    const bgBufferLength = 0; // empty

    const cols = 120;
    const rows = 40;
    if (shouldDeferResize(bgBufferLength)) {
      deferredResize = { cols, rows };
    } else {
      resizeFn(cols, rows);
    }

    expect(deferredResize).toBeNull();
    expect(resizeFn).toHaveBeenCalledWith(120, 40);
  });

  it("dedup: skips resize when dimensions unchanged", () => {
    const resizeFn = vi.fn();
    let lastDims: { cols: number; rows: number } | null = { cols: 80, rows: 24 };

    // Same dimensions as last time — should skip entirely
    const cols = 80;
    const rows = 24;
    if (lastDims && lastDims.cols === cols && lastDims.rows === rows) {
      // early return in the real code
    } else {
      lastDims = { cols, rows };
      resizeFn(cols, rows);
    }

    expect(resizeFn).not.toHaveBeenCalled();
  });

  it("dedup: sends resize when dimensions differ", () => {
    const resizeFn = vi.fn();
    let lastDims: { cols: number; rows: number } | null = { cols: 80, rows: 24 };

    const cols = 120;
    const rows = 40;
    if (lastDims && lastDims.cols === cols && lastDims.rows === rows) {
      // skip
    } else {
      lastDims = { cols, rows };
      resizeFn(cols, rows);
    }

    expect(resizeFn).toHaveBeenCalledWith(120, 40);
    expect(lastDims).toEqual({ cols: 120, rows: 40 });
  });
});

describe("deferred resize: flush-then-resize on visibility", () => {
  it("flushes buffer and returns deferred resize", () => {
    const chunk1 = new Uint8Array([1, 2, 3]);
    const chunk2 = new Uint8Array([4, 5]);
    const bgBuffer = [chunk1, chunk2];
    const deferred = { cols: 120, rows: 40 };

    const result = flushAndResize(bgBuffer, deferred);

    expect(result.mergedBuffer).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(result.resize).toEqual({ cols: 120, rows: 40 });
  });

  it("returns null buffer when bgBuffer is empty", () => {
    const result = flushAndResize([], { cols: 80, rows: 24 });
    expect(result.mergedBuffer).toBeNull();
    expect(result.resize).toEqual({ cols: 80, rows: 24 });
  });

  it("returns null resize when no deferred resize pending", () => {
    const chunk = new Uint8Array([1, 2, 3]);
    const result = flushAndResize([chunk], null);
    expect(result.mergedBuffer).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.resize).toBeNull();
  });

  it("returns both null when empty buffer and no deferred resize", () => {
    const result = flushAndResize([], null);
    expect(result.mergedBuffer).toBeNull();
    expect(result.resize).toBeNull();
  });
});

describe("deferred resize: respawn clears deferred state", () => {
  it("clearing bgBuffer and deferredResize prevents stale resize on next visibility", () => {
    // Simulate pre-respawn state
    let bgBuffer = [new Uint8Array([1, 2, 3])];
    let deferredResize: { cols: number; rows: number } | null = { cols: 120, rows: 40 };

    // Respawn cleanup (mirrors TerminalPanel.triggerRespawnRef.current)
    bgBuffer = [];
    deferredResize = null;

    // On next visibility, nothing stale should be flushed
    const result = flushAndResize(bgBuffer, deferredResize);
    expect(result.mergedBuffer).toBeNull();
    expect(result.resize).toBeNull();
  });
});

describe("deferred resize: full sequence simulation", () => {
  it("background data → deferred resize → tab switch → flush → resize", () => {
    const resizeFn = vi.fn();
    const writeFn = vi.fn();
    let bgBuffer: Uint8Array[] = [];
    let deferredResize: { cols: number; rows: number } | null = null;
    let visible = false;

    // 1. Tab goes to background, PTY data arrives
    visible = false;
    const data = new Uint8Array([65, 66, 67]); // "ABC"
    if (!visible) {
      bgBuffer.push(data);
    }

    // 2. Resize triggers while in background (e.g., window resize)
    const cols = 120;
    const rows = 40;
    if (shouldDeferResize(bgBuffer.length)) {
      deferredResize = { cols, rows };
    } else {
      resizeFn(cols, rows);
    }
    expect(resizeFn).not.toHaveBeenCalled();
    expect(deferredResize).toEqual({ cols: 120, rows: 40 });

    // 3. Tab becomes visible — flush buffer, then send deferred resize
    visible = true;
    const result = flushAndResize(bgBuffer, deferredResize);
    if (result.mergedBuffer) {
      writeFn(result.mergedBuffer);
      bgBuffer = [];
    }
    if (result.resize) {
      resizeFn(result.resize.cols, result.resize.rows);
      deferredResize = null;
    }

    expect(writeFn).toHaveBeenCalledWith(new Uint8Array([65, 66, 67]));
    expect(resizeFn).toHaveBeenCalledWith(120, 40);
    expect(bgBuffer).toHaveLength(0);
    expect(deferredResize).toBeNull();
  });

  it("multiple deferred resizes: only latest is sent", () => {
    const resizeFn = vi.fn();
    let bgBuffer: Uint8Array[] = [new Uint8Array([1])]; // non-empty
    let deferredResize: { cols: number; rows: number } | null = null;

    // First resize deferred
    if (shouldDeferResize(bgBuffer.length)) {
      deferredResize = { cols: 80, rows: 24 };
    }

    // Second resize overwrites (real code: lastPtyDimsRef dedup would prevent
    // same-dimensions, but different dimensions overwrite deferredResizeRef)
    if (shouldDeferResize(bgBuffer.length)) {
      deferredResize = { cols: 120, rows: 40 };
    }

    // Flush — only the latest resize is sent
    const result = flushAndResize(bgBuffer, deferredResize);
    if (result.resize) resizeFn(result.resize.cols, result.resize.rows);

    expect(resizeFn).toHaveBeenCalledTimes(1);
    expect(resizeFn).toHaveBeenCalledWith(120, 40);
  });
});
