import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type EventHandler = (event: { payload: { endpoint: string } }) => void;

const hoisted = vi.hoisted(() => {
  const state = {
    listeners: new Map<string, EventHandler[]>(),
    unlistenCalls: [] as Array<{ event: string; remaining: number }>,
    effects: [] as Array<{ fn: () => (() => void) | void; deps: unknown[] | undefined }>,
    markUserMessageMock: vi.fn() as ReturnType<typeof vi.fn>,
  };

  const listenMock = vi.fn(async (event: string, handler: EventHandler) => {
    if (!state.listeners.has(event)) state.listeners.set(event, []);
    state.listeners.get(event)!.push(handler);
    return () => {
      const arr = state.listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      }
      state.unlistenCalls.push({ event, remaining: arr?.length ?? 0 });
    };
  });

  return { state, listenMock };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: hoisted.listenMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("react", () => ({
  useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => {
    hoisted.state.effects.push({ fn, deps });
  },
}));

vi.mock("../../store/activity", () => ({
  useActivityStore: {
    getState: () => ({ markUserMessage: hoisted.state.markUserMessageMock }),
  },
}));

vi.mock("../../lib/debugLog", () => ({
  dlog: vi.fn(),
}));

import { useUserTurnListener } from "../useUserTurnListener";

function mount(sessionId: string | null): () => void {
  hoisted.state.effects.length = 0;
  useUserTurnListener(sessionId);
  if (hoisted.state.effects.length === 0) {
    return () => {};
  }
  expect(hoisted.state.effects).toHaveLength(1);
  const cleanup = hoisted.state.effects[0].fn();
  return () => {
    if (typeof cleanup === "function") cleanup();
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function dispatch(event: string, payload: { endpoint: string }): void {
  const handlers = hoisted.state.listeners.get(event) ?? [];
  for (const h of handlers) h({ payload });
}

describe("useUserTurnListener", () => {
  beforeEach(() => {
    hoisted.state.listeners = new Map();
    hoisted.state.unlistenCalls = [];
    hoisted.state.effects = [];
    hoisted.listenMock.mockClear();
    hoisted.state.markUserMessageMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not subscribe when sessionId is null", () => {
    mount(null);
    expect(hoisted.listenMock).not.toHaveBeenCalled();
  });

  it("subscribes to user-turn-started-{sessionId} when sessionId is set", () => {
    mount("sess-1");
    expect(hoisted.listenMock).toHaveBeenCalledTimes(1);
    expect(hoisted.listenMock).toHaveBeenCalledWith("user-turn-started-sess-1", expect.any(Function));
  });

  it("calls markUserMessage with the session id when the event fires", async () => {
    mount("sess-1");
    await flushMicrotasks();
    dispatch("user-turn-started-sess-1", { endpoint: "anthropic" });
    expect(hoisted.state.markUserMessageMock).toHaveBeenCalledTimes(1);
    expect(hoisted.state.markUserMessageMock).toHaveBeenCalledWith("sess-1");
  });

  it("does not call markUserMessage for events on other sessions", async () => {
    mount("sess-1");
    await flushMicrotasks();
    dispatch("user-turn-started-other-session", { endpoint: "anthropic" });
    expect(hoisted.state.markUserMessageMock).not.toHaveBeenCalled();
  });

  it("forwards every fire to markUserMessage (no debounce)", async () => {
    mount("sess-1");
    await flushMicrotasks();
    dispatch("user-turn-started-sess-1", { endpoint: "anthropic" });
    dispatch("user-turn-started-sess-1", { endpoint: "openai" });
    dispatch("user-turn-started-sess-1", { endpoint: "chatgpt" });
    expect(hoisted.state.markUserMessageMock).toHaveBeenCalledTimes(3);
    expect(hoisted.state.markUserMessageMock).toHaveBeenNthCalledWith(1, "sess-1");
    expect(hoisted.state.markUserMessageMock).toHaveBeenNthCalledWith(2, "sess-1");
    expect(hoisted.state.markUserMessageMock).toHaveBeenNthCalledWith(3, "sess-1");
  });

  it("unsubscribes on cleanup so subsequent dispatches are ignored", async () => {
    const unmount = mount("sess-1");
    await flushMicrotasks();
    unmount();
    await flushMicrotasks();
    dispatch("user-turn-started-sess-1", { endpoint: "anthropic" });
    expect(hoisted.state.markUserMessageMock).not.toHaveBeenCalled();
    expect(hoisted.state.unlistenCalls).toEqual([{ event: "user-turn-started-sess-1", remaining: 0 }]);
  });
});
