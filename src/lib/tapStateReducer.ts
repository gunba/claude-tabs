import type { TapEvent } from "../types/tapEvents";
import type { SessionState } from "../types/session";
import { isSessionIdle } from "../types/session";

/**
 * Pure state reducer: (state, event) → state.
 * No polling, no terminal buffer fallback — event-driven only.
 */
export function reduceTapEvent(state: SessionState, event: TapEvent): SessionState {
  // Sticky guard: actionNeeded persists until cleared by user events.
  // Bug 001: ToolCallStart(AskUserQuestion) sets actionNeeded, then ~4s later
  // ConversationMessage(assistant, tool_use) from the async stringify hook clobbers
  // it to toolUse. Tab shows "working" while actually waiting for user input.
  // See sequence replay test "001: AskUserQuestion actionNeeded survives async ConversationMessage".
  if (state === "actionNeeded") {
    switch (event.kind) {
      case "UserInput":
      case "SlashCommand":
        return "thinking";
      case "ToolResult":
        // Bug 003 primary: ToolResult(AskUserQuestion/ExitPlanMode) fires when
        // the user answers. Subagents cannot call these tools, so no collision risk.
        if (event.toolName === "AskUserQuestion" || event.toolName === "ExitPlanMode")
          return "thinking";
        return "actionNeeded";
      case "TurnStart":
        // Bug 003 fallback: no ConversationMessage(user) or ToolResult fires for
        // AskUserQuestion answers in some CLI versions. TurnStart is the only
        // guaranteed event when the agent continues. Risk: background subagent
        // TurnStart (no agentId field) prematurely clears — cosmetic, not functional.
        return "thinking";
      case "UserInterruption":
        return "interrupted";
      case "PermissionPromptShown":
        return "waitingPermission";
      case "ConversationMessage":
        if (event.messageType === "user" && !event.isSidechain) return "thinking";
        return "actionNeeded";
      case "IdlePrompt":
        return "idle";
      default:
        return "actionNeeded";
    }
  }

  switch (event.kind) {
    // New turn or streaming content = Claude is actively working
    case "TurnStart":
    case "ThinkingStart":
    case "TextStart":
      return "thinking";

    case "ToolCallStart":
      if (event.toolName === "ExitPlanMode" || event.toolName === "AskUserQuestion") return "actionNeeded";
      return "thinking";

    case "TurnEnd":
      if (event.stopReason === "tool_use") return "toolUse";
      if (event.stopReason === "end_turn") return "idle";
      return state;

    case "PermissionPromptShown":
      return "waitingPermission";

    case "PermissionApproved":
      return "toolUse";

    case "PermissionRejected":
      return "idle";

    case "IdlePrompt":
      return "idle";

    case "UserInput":
    case "SlashCommand":
      return "thinking";

    case "UserInterruption":
      return "interrupted";

    case "ConversationMessage":
      if (event.messageType === "user" && !event.isSidechain) return "thinking";
      if (event.messageType === "assistant" && !event.isSidechain) {
        if (event.stopReason === "tool_use") return "toolUse";
        if (event.stopReason === "end_turn") return "idle";
      }
      return state;

    default:
      return state;
  }
}

/**
 * Batch reducer: fold multiple events, applying priority rules.
 * waitingPermission always wins if any event in the batch triggers it.
 */
export function reduceTapBatch(state: SessionState, events: TapEvent[]): SessionState {
  let result = state;
  let hasPermission = false;

  for (const event of events) {
    result = reduceTapEvent(result, event);
    if (result === "waitingPermission") hasPermission = true;
  }

  // waitingPermission takes priority over any subsequent state in the same batch
  if (hasPermission && !isSessionIdle(result)) return "waitingPermission";

  return result;
}

/**
 * Check if an event represents a genuine completion (transition to idle).
 * Used by useTapEventProcessor for queued input dispatch signaling.
 */
export function isCompletionEvent(event: TapEvent): boolean {
  return (event.kind === "ConversationMessage"
    && event.messageType === "assistant"
    && event.stopReason === "end_turn"
    && !event.isSidechain)
    || event.kind === "IdlePrompt";
}
