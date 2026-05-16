import { invoke } from "@tauri-apps/api/core";
import type { CapturedMessage, SubagentMessage } from "../types/session";

// [IN-35] Codex child rollouts are loaded on inspector open AND hydrated continuously
// into the subagent bar on every CodexSubagentSpawned/CodexSubagentStatus event so the
// subagent's chat history populates without waiting for the inspector modal to open.

export interface CodexThreadInspectorPayload {
  messages: CapturedMessage[];
  completed: boolean;
  lastAgentMessage: string | null;
  durationMs: number | null;
}

// arXiv-style v7 UUIDs used by Codex thread ids (32 hex + 4 dashes after the "019" prefix).
const CODEX_THREAD_ID = /^019[0-9a-f-]{33}$/i;

export function isCodexThreadId(id: string): boolean {
  return CODEX_THREAD_ID.test(id);
}

export function normalizeCodexToolName(name: string): string {
  return name === "shell" || name === "exec_command" || name === "shell_command" || name === "local_shell"
    ? "Bash"
    : name;
}

export function codexToolInput(name: string, input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const parsed = input as Record<string, unknown>;
  if (normalizeCodexToolName(name) !== "Bash") return parsed;
  const command = typeof parsed.cmd === "string"
    ? parsed.cmd
    : typeof parsed.command === "string" ? parsed.command : "";
  return { ...parsed, command, description: "Codex command" };
}

export function codexCapturedToSubagentMessages(messages: CapturedMessage[]): SubagentMessage[] {
  const out: SubagentMessage[] = [];
  for (const message of messages) {
    for (const block of message.content) {
      if (message.role === "assistant" && block.type === "text" && block.text) {
        out.push({ role: "assistant", text: block.text, timestamp: Date.now() });
      } else if (message.role === "assistant" && block.type === "tool_use") {
        const rawName = block.name || "tool";
        const toolName = normalizeCodexToolName(rawName);
        const toolInput = codexToolInput(rawName, block.input);
        const command = toolInput && typeof toolInput.command === "string" ? toolInput.command : null;
        const text = command || `${rawName}: ${JSON.stringify(block.input ?? {})}`;
        out.push({ role: "tool", text, toolName, toolInput, timestamp: Date.now() });
      } else if (message.role === "user" && block.type === "tool_result" && block.text) {
        out.push({ role: "tool", text: block.text, toolName: "result", timestamp: Date.now() });
      }
    }
  }
  return out;
}

export async function loadCodexThreadInspector(
  threadId: string,
): Promise<CodexThreadInspectorPayload | null> {
  if (!isCodexThreadId(threadId)) return null;
  try {
    return await invoke<CodexThreadInspectorPayload>("read_codex_thread_inspector", { threadId });
  } catch {
    return null;
  }
}
