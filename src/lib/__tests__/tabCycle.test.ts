import { describe, expect, it } from "vitest";
import { cycleTabId, jumpTabId, type TabCycleSession } from "../tabCycle";

const sessions: TabCycleSession[] = [
  { id: "one", state: "idle" },
  { id: "meta", state: "idle", isMetaAgent: true },
  { id: "dead", state: "dead" },
  { id: "two", state: "thinking" },
  { id: "three", state: "idle" },
];

describe("cycleTabId", () => {
  it("cycles through live non-meta tabs", () => {
    expect(cycleTabId(sessions, "one", "next")).toBe("two");
    expect(cycleTabId(sessions, "two", "next")).toBe("three");
    expect(cycleTabId(sessions, "three", "next")).toBe("one");
  });

  it("cycles backwards through live non-meta tabs", () => {
    expect(cycleTabId(sessions, "one", "previous")).toBe("three");
    expect(cycleTabId(sessions, "three", "previous")).toBe("two");
  });

  it("starts at the edge when there is no active live tab", () => {
    expect(cycleTabId(sessions, null, "next")).toBe("one");
    expect(cycleTabId(sessions, "dead", "previous")).toBe("three");
  });

  it("returns null when no live tab exists", () => {
    expect(cycleTabId([{ id: "dead", state: "dead" }], "dead", "next")).toBeNull();
  });
});

describe("jumpTabId", () => {
  it("jumps by one-based non-meta index including dead tabs", () => {
    expect(jumpTabId(sessions, 1)).toBe("one");
    expect(jumpTabId(sessions, 2)).toBe("dead");
    expect(jumpTabId(sessions, 4)).toBe("three");
  });

  it("returns null for invalid or missing indexes", () => {
    expect(jumpTabId(sessions, 0)).toBeNull();
    expect(jumpTabId(sessions, 10)).toBeNull();
    expect(jumpTabId(sessions, 1.5)).toBeNull();
  });
});
