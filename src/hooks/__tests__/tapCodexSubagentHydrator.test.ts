import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../../store/sessions";
import type { CapturedMessage, Subagent } from "../../types/session";
import {
  _resetCodexSubagentHydratorForTests,
  hydrateCodexSubagentMessages,
} from "../tapCodexSubagentHydrator";

const mockInvoke = vi.mocked(invoke);

const CODEX_THREAD_ID = "019e3004-f164-74d0-9188-61ffc0022c8e";
const SESSION_ID = "session-1";

function makeCodexSubagent(overrides: Partial<Subagent> = {}): Subagent {
  return {
    id: CODEX_THREAD_ID,
    parentSessionId: SESSION_ID,
    state: "starting",
    description: "Codex agent",
    tokenCount: 0,
    currentAction: null,
    currentToolName: null,
    currentEventKind: "CodexSubagentSpawned",
    messages: [],
    createdAt: 1000,
    ...overrides,
  };
}

function getSubagent(): Subagent | undefined {
  return useSessionStore.getState().subagents.get(SESSION_ID)?.find((sa) => sa.id === CODEX_THREAD_ID);
}

function makeMessage(role: "assistant" | "user", content: CapturedMessage["content"]): CapturedMessage {
  return { role, content };
}

async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  mockInvoke.mockReset();
  _resetCodexSubagentHydratorForTests();
  useSessionStore.setState({
    subagents: new Map([[SESSION_ID, [makeCodexSubagent()]]]),
  });
});

describe("hydrateCodexSubagentMessages", () => {
  it("pushes converted messages into the store from a Codex thread payload", async () => {
    mockInvoke.mockResolvedValueOnce({
      messages: [
        makeMessage("assistant", [{ type: "text", text: "Hello world" }]),
      ],
      completed: false,
      lastAgentMessage: null,
      durationMs: null,
    });

    hydrateCodexSubagentMessages(SESSION_ID, CODEX_THREAD_ID);

    await flushMicrotasks();

    const subagent = getSubagent();
    expect(subagent).toBeDefined();
    expect(subagent!.messages.length).toBe(1);
    expect(subagent!.messages[0]).toMatchObject({ role: "assistant", text: "Hello world" });
    expect(mockInvoke).toHaveBeenCalledWith("read_codex_thread_inspector", { threadId: CODEX_THREAD_ID });
  });

  it("marks the subagent completed when the rollout reports task_complete", async () => {
    mockInvoke.mockResolvedValueOnce({
      messages: [
        makeMessage("assistant", [{ type: "text", text: "done" }]),
      ],
      completed: true,
      lastAgentMessage: "done",
      durationMs: 4154,
    });

    hydrateCodexSubagentMessages(SESSION_ID, CODEX_THREAD_ID);

    await flushMicrotasks();

    const subagent = getSubagent();
    expect(subagent).toBeDefined();
    expect(subagent!.completed).toBe(true);
    expect(subagent!.state).toBe("dead");
    expect(subagent!.resultText).toBe("done");
    expect(subagent!.durationMs).toBe(4154);
    // Last assistant message duplicates the result and is trimmed from the conversation.
    expect(subagent!.messages.length).toBe(0);
  });

  it("ignores non-Codex thread ids", async () => {
    hydrateCodexSubagentMessages(SESSION_ID, "agent-abc123");
    await flushMicrotasks();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("no-ops when the subagent record is no longer in the store", async () => {
    useSessionStore.setState({ subagents: new Map() });
    mockInvoke.mockResolvedValueOnce({
      messages: [makeMessage("assistant", [{ type: "text", text: "ignored" }])],
      completed: false,
      lastAgentMessage: null,
      durationMs: null,
    });

    hydrateCodexSubagentMessages(SESSION_ID, CODEX_THREAD_ID);
    await flushMicrotasks();

    expect(useSessionStore.getState().subagents.get(SESSION_ID)).toBeUndefined();
  });

  it("coalesces overlapping hydrations into a single follow-up run", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    mockInvoke
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

    hydrateCodexSubagentMessages(SESSION_ID, CODEX_THREAD_ID);
    hydrateCodexSubagentMessages(SESSION_ID, CODEX_THREAD_ID);
    hydrateCodexSubagentMessages(SESSION_ID, CODEX_THREAD_ID);

    // Only the initial invoke is in flight.
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    resolveFirst({
      messages: [makeMessage("assistant", [{ type: "text", text: "first" }])],
      completed: false,
      lastAgentMessage: null,
      durationMs: null,
    });
    await flushMicrotasks();

    // One pending follow-up survived (multiple requests collapse to one).
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    resolveSecond({
      messages: [makeMessage("assistant", [{ type: "text", text: "second" }])],
      completed: false,
      lastAgentMessage: null,
      durationMs: null,
    });
    await flushMicrotasks();

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(getSubagent()!.messages[0]).toMatchObject({ role: "assistant", text: "second" });
  });

  it("converts a Codex shell tool_use into a Bash subagent message", async () => {
    mockInvoke.mockResolvedValueOnce({
      messages: [
        makeMessage("assistant", [
          { type: "tool_use", id: "call_1", name: "shell", input: { command: "ls -la" } },
        ]),
      ],
      completed: false,
      lastAgentMessage: null,
      durationMs: null,
    });

    hydrateCodexSubagentMessages(SESSION_ID, CODEX_THREAD_ID);
    await flushMicrotasks();

    const messages = getSubagent()!.messages;
    expect(messages.length).toBe(1);
    expect(messages[0]).toMatchObject({
      role: "tool",
      toolName: "Bash",
      text: "ls -la",
    });
    expect(messages[0].toolInput).toMatchObject({ command: "ls -la", description: "Codex command" });
  });
});
