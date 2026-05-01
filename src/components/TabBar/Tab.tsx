import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { IconClose, IconStop } from "../Icons/Icons";
import { ProviderLogo } from "../ProviderLogo/ProviderLogo";
import {
  canResumeSession,
  dirToTabName,
  getActivityColor,
  getActivityText,
  getEffectiveState,
} from "../../lib/claude";
import { getNoisyEventKinds } from "../../lib/noisyEventKinds";
import { parseWorktreePath } from "../../lib/paths";
import { buildTabStatusSpans } from "../../lib/tabStatusSpans";
import type { SettledKind } from "../../lib/settledState";
import type { Session, Subagent } from "../../types/session";

interface TabProps {
  session: Session;
  subagents: Subagent[];
  activeTabId: string | null;
  ctrlHeld: boolean;
  dropSide: "before" | "after" | null;
  settledKind?: SettledKind;
  inspectorOff: boolean;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onRequestKill: (sessionId: string) => void;
  onRelaunchWithOptions: (session: Session) => void;
  onOpenContextMenu: (menu: { x: number; y: number; sessionId: string }) => void;
  onClearSettled: (sessionId: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, session: Session, fullName: string) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, session: Session) => void;
  onDrop: (session: Session) => void;
  onDragEnd: () => void;
}

export function Tab({
  session,
  subagents,
  activeTabId,
  ctrlHeld,
  dropSide,
  settledKind,
  inspectorOff,
  onActivate,
  onClose,
  onRequestKill,
  onRelaunchWithOptions,
  onOpenContextMenu,
  onClearSettled,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TabProps) {
  const isActive = session.id === activeTabId;
  const fullName = session.name || dirToTabName(session.config.workingDir);
  const isDead = session.state === "dead";
  const noisyEventKinds = getNoisyEventKinds(session.config.cli);
  const activity = getActivityText(
    session.metadata.currentToolName,
    session.metadata.currentEventKind,
    noisyEventKinds,
  );
  const activityColor = getActivityColor(
    session.metadata.currentToolName,
    session.metadata.currentEventKind,
    noisyEventKinds,
  );
  const effectiveState = getEffectiveState(session.state, subagents);
  const worktree = parseWorktreePath(session.config.workingDir);
  const statusSpans = buildTabStatusSpans(session, subagents);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.ctrlKey && canResumeSession(session)) {
      onRelaunchWithOptions(session);
      return;
    }
    onActivate(session.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate(session.id);
    }
  };

  return (
    // [CV-01] Per-tab CLI identity: class tab-cli-{cli} plus ProviderLogo in the CLI row.
    <div
      className={`tab tab-cli-${session.config.cli}${isActive ? " tab-active" : ""}${isDead ? " tab-dead" : ""}${session.config.runMode ? " tab-run" : ""}${dropSide === "before" ? " tab-drop-before" : dropSide === "after" ? " tab-drop-after" : ""}${settledKind === "idle" ? " tab-settled-idle" : ""}${settledKind === "actionNeeded" || settledKind === "waitingPermission" ? " tab-settled-action" : ""}`}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(event) => onDragStart(event, session, fullName)}
      onDragOver={(event) => onDragOver(event, session)}
      onDrop={() => onDrop(session)}
      onDragEnd={onDragEnd}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenContextMenu({ x: event.clientX, y: event.clientY, sessionId: session.id });
      }}
      onMouseEnter={() => onClearSettled(session.id)}
      title={ctrlHeld ? `Ctrl+Click: Relaunch ${fullName}` : `${fullName} - ${effectiveState}\n${session.config.workingDir}${worktree ? `\nWorktree: ${worktree.worktreeName}` : ""}`}
    >
      <span className={`tab-dot state-${effectiveState}${inspectorOff ? " inspector-off" : ""}`} />
      <span className="tab-label">
        <span className="tab-name">{fullName}</span>
        <span className="tab-meta-row">
          <span
            className={`tab-cli-row tab-cli-row-${session.config.cli}`}
            title={session.config.cli === "codex" ? "Codex" : "Claude Code"}
          >
            <ProviderLogo cli={session.config.cli} size={12} />
          </span>
          {activity && (
            <span className="tab-activity" style={{ color: activityColor ?? "var(--text-secondary)" }}>
              {activity}
            </span>
          )}
        </span>
        <span className="tab-status-row">
          {statusSpans.map((span, index) => (
            <span key={index}>
              {index > 0 && <span style={{ color: "var(--text-muted)", opacity: 0.5 }}> &middot; </span>}
              <span style={{ color: span.color }} title={span.title}>{span.text}</span>
            </span>
          ))}
        </span>
      </span>
      <span className="tab-actions">
        {session.state !== "dead" && (
          <button
            className="tab-kill"
            onClick={(event) => {
              event.stopPropagation();
              onRequestKill(session.id);
            }}
            title="Kill agent (keep tab)"
          >
            <IconStop size={9} />
          </button>
        )}
        <button
          className="tab-close"
          onClick={(event) => {
            event.stopPropagation();
            onClose(session.id);
          }}
          title="Close"
        >
          <IconClose size={12} />
        </button>
      </span>
    </div>
  );
}
