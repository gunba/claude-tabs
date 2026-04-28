import { AgentTypeIcon } from "../AgentTypeIcon/AgentTypeIcon";
import { getActivityColor, getActivityText, formatTokenCount } from "../../lib/claude";
import { getNoisyEventKinds } from "../../lib/noisyEventKinds";
import type { CliKind, Subagent } from "../../types/session";
import { isSubagentActive } from "../../types/session";

interface SubagentBarProps {
  subagents: Subagent[];
  activeProvider: CliKind;
  activeTabId: string | null;
  inspectedSubagent: { sessionId: string; subagentId: string } | null;
  onInspect: (sessionId: string, subagentId: string) => void;
}

export function SubagentBar({
  subagents,
  activeProvider,
  activeTabId,
  inspectedSubagent,
  onInspect,
}: SubagentBarProps) {
  const noisyEventKinds = getNoisyEventKinds(activeProvider);
  const visibleSubagents = subagents
    .filter((subagent) => !subagent.id.startsWith("aside_question"))
    .map((subagent) => ({ subagent, ts: subagent.createdAt || 0 }))
    .sort((a, b) => b.ts - a.ts);

  if (visibleSubagents.length === 0) return null;

  return (
    <div className="subagent-bar">
      {visibleSubagents.map(({ subagent }) => {
        const isActive = isSubagentActive(subagent.state);
        const isCompleted = !!subagent.completed;
        const isDead = subagent.state === "dead" && !isCompleted;
        const isIdle = subagent.state === "idle";
        const isInterrupted = subagent.state === "interrupted";
        const isSelected =
          inspectedSubagent?.subagentId === subagent.id &&
          inspectedSubagent?.sessionId === activeTabId;
        const activity = getActivityText(
          subagent.currentToolName,
          subagent.currentEventKind,
          noisyEventKinds,
        );
        const activityColor = getActivityColor(
          subagent.currentToolName,
          subagent.currentEventKind,
          noisyEventKinds,
        );
        const typeLabel = subagent.subagentType || subagent.agentType;
        const statusText = activity ?? (isCompleted ? "Completed" : subagent.state);
        const statusColor = activityColor ?? (isCompleted ? "var(--success)" : "var(--text-secondary)");
        const statusSpans: string[] = [];
        if (subagent.totalToolUses != null) statusSpans.push(`${subagent.totalToolUses} tools`);
        if (subagent.durationMs != null) statusSpans.push(`${Math.round(subagent.durationMs / 1000)}s`);
        if (subagent.tokenCount > 0) statusSpans.push(formatTokenCount(subagent.tokenCount));

        return (
          <button
            key={subagent.id}
            className={`subagent-card${isActive ? " subagent-active" : ""}${isCompleted ? " subagent-completed" : ""}${isDead ? " subagent-dead" : ""}${isIdle ? " subagent-idle" : ""}${isInterrupted ? " subagent-interrupted" : ""}${isSelected ? " subagent-selected" : ""}`}
            onClick={() => activeTabId && onInspect(activeTabId, subagent.id)}
            title={subagent.description}
          >
            {isCompleted
              ? <span className="subagent-check" />
              : <span className={`tab-dot state-${subagent.state}`} />
            }
            <span className="subagent-label">
              <span className="subagent-name">{subagent.description}</span>
              <span className="subagent-type">
                <AgentTypeIcon type={typeLabel} size={10} className="subagent-type-icon" />
                {typeLabel ?? "Agent"}
              </span>
              <span className="subagent-status-row">
                <span style={{ color: statusColor }}>
                  {statusText}
                </span>
                {statusSpans.map((part, index) => (
                  <span key={index}>
                    <span style={{ color: "var(--text-muted)", opacity: 0.5 }}> &middot; </span>
                    <span>{part}</span>
                  </span>
                ))}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
