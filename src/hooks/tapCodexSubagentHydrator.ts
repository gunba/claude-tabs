import { useSessionStore } from "../store/sessions";
import { dlog } from "../lib/debugLog";
import {
  codexCapturedToSubagentMessages,
  isCodexThreadId,
  loadCodexThreadInspector,
  type CodexThreadInspectorPayload,
} from "../lib/codexSubagentMessages";
import type { Subagent } from "../types/session";

// [IN-35] Eager-load Codex subagent child rollouts into the subagent bar so chat
// history appears live without the user having to open the inspector modal. Fires
// on every CodexSubagentSpawned / CodexSubagentStatus event from useTapEventProcessor.

// Tracks in-flight hydration per (sessionId, agentId) so multiple status events
// arriving in quick succession do not pile up overlapping invokes for the same
// rollout file. When a request arrives while one is in flight we set
// nextRequested; the in-flight chain re-runs once it settles so the UI ends on
// the latest snapshot.
const pending = new Map<string, { nextRequested: boolean }>();

function pendingKey(sessionId: string, agentId: string): string {
  return `${sessionId}::${agentId}`;
}

function applyPayload(
  sessionId: string,
  agentId: string,
  payload: CodexThreadInspectorPayload,
): void {
  const store = useSessionStore.getState();
  const list = store.subagents.get(sessionId);
  const current = list?.find((sa) => sa.id === agentId);
  // Only update if the subagent record exists — the tracker creates it from the
  // spawn/status event; if it's gone (e.g. cleared on prompt boundary) skip.
  if (!current) return;

  const loadedMessages = codexCapturedToSubagentMessages(payload.messages);
  const loadedResult = payload.lastAgentMessage || current.resultText;
  const lastMsg = loadedMessages[loadedMessages.length - 1];
  // Mirror the inspector's logic: when the trailing assistant message duplicates
  // the result text, drop it from the conversation so the Result section is the
  // only place it appears.
  const trimmedMessages = loadedMessages.length > 0
    && loadedResult
    && lastMsg
    && lastMsg.role === "assistant"
    && lastMsg.text === loadedResult
      ? loadedMessages.slice(0, -1)
      : loadedMessages;

  const updates: Partial<Subagent> = { messages: trimmedMessages };
  if (loadedResult && loadedResult !== current.resultText) {
    updates.resultText = loadedResult;
  }
  if (payload.durationMs != null && payload.durationMs !== current.durationMs) {
    updates.durationMs = payload.durationMs;
  }
  if (payload.completed && !current.completed) {
    updates.completed = true;
    updates.state = "dead";
  }
  store.updateSubagent(sessionId, agentId, updates);
}

async function runHydration(sessionId: string, agentId: string): Promise<void> {
  const key = pendingKey(sessionId, agentId);
  const entry = pending.get(key);
  if (!entry) return;
  try {
    const payload = await loadCodexThreadInspector(agentId);
    if (payload) {
      applyPayload(sessionId, agentId, payload);
    }
  } catch (err) {
    dlog("inspector", sessionId, `codex subagent hydrate failed agent=${agentId} err=${String(err)}`, "WARN");
  } finally {
    const after = pending.get(key);
    if (after?.nextRequested) {
      after.nextRequested = false;
      // Chain another hydration to pick up newer rollout content that arrived
      // while the previous invoke was in-flight.
      runHydration(sessionId, agentId);
    } else {
      pending.delete(key);
    }
  }
}

export function hydrateCodexSubagentMessages(sessionId: string, agentId: string): void {
  if (!isCodexThreadId(agentId)) return;
  const key = pendingKey(sessionId, agentId);
  const existing = pending.get(key);
  if (existing) {
    existing.nextRequested = true;
    return;
  }
  pending.set(key, { nextRequested: false });
  runHydration(sessionId, agentId);
}

/** Test-only: clear any in-flight hydration bookkeeping between runs. */
export function _resetCodexSubagentHydratorForTests(): void {
  pending.clear();
}
