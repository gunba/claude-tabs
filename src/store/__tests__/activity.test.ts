import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { useActivityStore } from "../activity";
import { emptySessionActivity } from "../../types/activity";
import type { ProcessInfo } from "../../types/activity";

/**
 * Tests for the tracer dedup window in addFileActivityFromTracer.
 * [AS-04] / [PO-03]: a tracer event for a path+kind already recorded by
 * the TAP pipeline within TRACER_DEDUP_MS should NOT create a new entry;
 * the tracer may only backfill the processChain onto the TAP entry.
 */

const SESSION = "s1";

function resetStore() {
  useActivityStore.setState({ sessions: {} });
}

function chain(): ProcessInfo[] {
  return [
    { pid: 1234, exe: "/usr/bin/bash", argv: ["bash", "-lc", "echo hi"] },
  ];
}

describe("activity store tracer dedup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T00:00:00Z"));
    resetStore();
    useActivityStore.setState({
      sessions: { [SESSION]: emptySessionActivity() },
    });
    useActivityStore.getState().startTurn(SESSION, "turn-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("attaches processChain to a TAP entry when tracer fires within the dedup window", () => {
    useActivityStore.getState().addFileActivity(SESSION, "/p/a.ts", "modified", {
      toolName: "Edit",
    });

    vi.advanceTimersByTime(50);

    useActivityStore
      .getState()
      .addFileActivityFromTracer(SESSION, "/p/a.ts", "modified", chain(), false);

    const entry = useActivityStore.getState().sessions[SESSION].allFiles["/p/a.ts"];
    expect(entry.toolName).toBe("Edit"); // TAP metadata preserved
    expect(entry.processChain?.[0]?.exe).toBe("/usr/bin/bash");

    const turn = useActivityStore.getState().sessions[SESSION].turns[0];
    expect(turn.files.filter((f) => f.path === "/p/a.ts")).toHaveLength(1);
  });

  it("creates a new tracer-only entry once the dedup window elapses", () => {
    useActivityStore.getState().addFileActivity(SESSION, "/p/b.ts", "modified");

    vi.advanceTimersByTime(300); // > TRACER_DEDUP_MS (200)

    useActivityStore
      .getState()
      .addFileActivityFromTracer(SESSION, "/p/b.ts", "modified", chain(), false);

    const turn = useActivityStore.getState().sessions[SESSION].turns[0];
    expect(turn.files.filter((f) => f.path === "/p/b.ts").length).toBeGreaterThanOrEqual(1);
    const last = turn.files[turn.files.length - 1];
    expect(last.processChain?.length).toBe(1);
  });

  it("is a no-op when the TAP entry already has a processChain", () => {
    const preChain: ProcessInfo[] = [
      { pid: 99, exe: "/prev", argv: [] },
    ];
    useActivityStore.getState().addFileActivity(SESSION, "/p/c.ts", "modified", {
      processChain: preChain,
    });

    vi.advanceTimersByTime(50);

    useActivityStore
      .getState()
      .addFileActivityFromTracer(SESSION, "/p/c.ts", "modified", chain(), false);

    const entry = useActivityStore.getState().sessions[SESSION].allFiles["/p/c.ts"];
    expect(entry.processChain).toBe(preChain); // unchanged reference
  });

  it("creates a tracer entry when TAP has not seen the path", () => {
    useActivityStore
      .getState()
      .addFileActivityFromTracer(SESSION, "/p/d.ts", "created", chain(), false);

    const entry = useActivityStore.getState().sessions[SESSION].allFiles["/p/d.ts"];
    expect(entry.kind).toBe("created");
    expect(entry.processChain?.[0]?.exe).toBe("/usr/bin/bash");
    expect(entry.toolName).toBeNull();
  });
});
