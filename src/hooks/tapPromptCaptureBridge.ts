import { useSessionStore } from "../store/sessions";
import { useSettingsStore } from "../store/settings";
import { dlog } from "../lib/debugLog";
import { buildSubagentTabs } from "../lib/contextProjection";
import type { TapEvent } from "../types/tapEvents";

type SystemPromptCaptureEvent = Extract<TapEvent, { kind: "SystemPromptCapture" }>;

export function handleTapPromptCaptureBridge(
  sid: string,
  event: SystemPromptCaptureEvent,
): void {
  const sessionCli =
    useSessionStore.getState().sessions.find((s) => s.id === sid)?.config.cli ?? "claude";
  useSettingsStore.getState().addObservedPrompt(event.text, event.model, sessionCli);

  // Bridge resultText from capturedMessages to TAP-derived subagents.
  // capturedMessages pair Agent tool_use with tool_result blocks authoritatively,
  // but TAP subagents never get resultText because SubagentNotification doesn't fire.
  if (!event.messages) return;

  const tabs = buildSubagentTabs(event.messages);
  const subagents = useSessionStore.getState().subagents.get(sid) || [];
  for (const tab of tabs) {
    if (!tab.resultText) continue;
    const labelPrefix = tab.label.endsWith("\u2026") ? tab.label.slice(0, -1) : tab.label;
    if (labelPrefix.length < 3) continue;
    // Match by description prefix + prompt text to avoid ambiguous collisions
    const candidates = subagents.filter(sub => sub.description.startsWith(labelPrefix));
    const matched = candidates.length === 1
      ? candidates[0]
      : candidates.find(sub => sub.promptText && sub.promptText === tab.promptText) ?? null;
    if (matched && !matched.resultText) {
      useSessionStore.getState().updateSubagent(sid, matched.id, { resultText: tab.resultText, completed: true });
    }
  }

  // Prune phantom subagents that don't correspond to any Agent tool_use
  // in capturedMessages (e.g. CLI-internal aside_question sidechains).
  // Match by exact promptText (precise) with description prefix fallback.
  // Guard: never prune agents that already have resultText — they were
  // previously validated against capturedMessages and may have been
  // compacted away since.
  if (tabs.length > 0 && subagents.length > tabs.length) {
    const tabPrompts = new Set(tabs.map(t => t.promptText).filter(Boolean));
    for (const sub of subagents) {
      // Exact prompt match (precise)
      if (sub.promptText && tabPrompts.has(sub.promptText)) continue;
      // Description prefix fallback (for agents without promptText)
      const matchesByDesc = tabs.some(tab => {
        const prefix = tab.label.endsWith("\u2026") ? tab.label.slice(0, -1) : tab.label;
        return prefix.length >= 3 && sub.description.startsWith(prefix);
      });
      if (matchesByDesc) continue;
      // Only prune completed phantoms without resultText.
      // Agents with resultText were previously validated and are safe
      // from compaction-induced false positives.
      if (sub.completed && !sub.resultText) {
        dlog("inspector", sid, `pruning phantom subagent ${sub.id} desc="${sub.description}"`, "DEBUG");
        useSessionStore.getState().removeSubagent(sid, sub.id);
      }
    }
  }
}
