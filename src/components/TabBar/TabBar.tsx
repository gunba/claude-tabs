import { useRef, useState, type DragEvent } from "react";
import { HeaderActivityViz } from "../HeaderActivityViz/HeaderActivityViz";
import { IconFolder, IconGear, IconReturn } from "../Icons/Icons";
import { swapWithinGroup, type TabGroup } from "../../lib/paths";
import type { SettledKind } from "../../lib/settledState";
import type { Session, Subagent } from "../../types/session";
import { Tab } from "./Tab";

interface TabBarProps {
  groups: TabGroup[];
  regularSessions: Session[];
  activeTabId: string | null;
  subagentMap: Map<string, Subagent[]>;
  settledTabs: Map<string, SettledKind>;
  inspectorOffSessions: Set<string>;
  ctrlHeld: boolean;
  onActivate: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onRequestKill: (sessionId: string) => void;
  onReorderTabs: (sessionIds: string[]) => void;
  onRelaunchWithOptions: (session: Session) => void;
  onOpenContextMenu: (menu: { x: number; y: number; sessionId: string }) => void;
  onClearSettled: (sessionId: string) => void;
  onOpenResumePicker: () => void;
  onOpenConfigManager: () => void;
  onOpenLauncher: () => void;
  onQuickLaunch: () => void;
}

export function TabBar({
  groups,
  regularSessions,
  activeTabId,
  subagentMap,
  settledTabs,
  inspectorOffSessions,
  ctrlHeld,
  onActivate,
  onCloseSession,
  onRequestKill,
  onReorderTabs,
  onRelaunchWithOptions,
  onOpenContextMenu,
  onClearSettled,
  onOpenResumePicker,
  onOpenConfigManager,
  onOpenLauncher,
  onQuickLaunch,
}: TabBarProps) {
  const dragTabRef = useRef<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  const clearDragState = () => {
    dragTabRef.current = null;
    setDragOverTabId(null);
  };

  const handleDragStart = (
    event: DragEvent<HTMLDivElement>,
    session: Session,
    fullName: string,
  ) => {
    dragTabRef.current = session.id;
    const ghost = document.createElement("div");
    ghost.textContent = fullName;
    ghost.style.cssText = "position:absolute;top:-999px;padding:4px 8px;background:var(--bg-surface);color:var(--text-primary);font-size:11px;border-radius:4px;white-space:nowrap;";
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 0, 0);
    requestAnimationFrame(() => ghost.remove());
  };

  const groupForSession = (sessionId: string): TabGroup | null =>
    groups.find((group) => group.sessions.some((s) => s.id === sessionId)) ?? null;

  const handleDragOver = (event: DragEvent<HTMLDivElement>, session: Session) => {
    event.preventDefault();
    const sourceId = dragTabRef.current;
    const group = groupForSession(session.id);
    if (sourceId && sourceId !== session.id && group?.sessions.some((s) => s.id === sourceId)) {
      setDragOverTabId(session.id);
    }
  };

  const handleDrop = (session: Session) => {
    setDragOverTabId(null);
    const sourceId = dragTabRef.current;
    const group = groupForSession(session.id);
    if (sourceId && sourceId !== session.id && group?.sessions.some((s) => s.id === sourceId)) {
      const order = regularSessions.map((s) => s.id);
      const fromIndex = order.indexOf(sourceId);
      const toIndex = order.indexOf(session.id);
      if (fromIndex >= 0 && toIndex >= 0) {
        order.splice(fromIndex, 1);
        order.splice(toIndex, 0, sourceId);
        onReorderTabs(order);
      }
    }
    dragTabRef.current = null;
  };

  const moveWithinGroup = (sessionId: string, direction: "left" | "right") => {
    const order = swapWithinGroup(
      regularSessions.map((session) => session.id),
      sessionId,
      direction,
      groups,
    );
    if (order) onReorderTabs(order);
  };

  return (
    <div className="tab-bar">
      <div className="tab-bar-scroll">
        {groups.flatMap((group) => [
          <div
            key={`hdr-${group.key}`}
            className="tab-group-header"
            style={{ ["--tab-count" as string]: group.sessions.length }}
            title={group.fullPath}
          >
            <IconFolder size={10} className="tab-group-header-icon" />
            <span className="tab-group-header-label">{group.label}</span>
          </div>,
          ...group.sessions.map((session, index) => (
            <Tab
              key={session.id}
              session={session}
              subagents={subagentMap.get(session.id) || []}
              activeTabId={activeTabId}
              ctrlHeld={ctrlHeld}
              groupSize={group.sessions.length}
              groupIndex={index}
              dragOver={dragOverTabId === session.id}
              settledKind={settledTabs.get(session.id)}
              inspectorOff={inspectorOffSessions.has(session.id)}
              onActivate={onActivate}
              onClose={onCloseSession}
              onRequestKill={onRequestKill}
              onRelaunchWithOptions={onRelaunchWithOptions}
              onOpenContextMenu={onOpenContextMenu}
              onMoveWithinGroup={moveWithinGroup}
              onClearSettled={onClearSettled}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={(sessionId) => {
                if (dragOverTabId === sessionId) setDragOverTabId(null);
              }}
              onDrop={handleDrop}
              onDragEnd={clearDragState}
            />
          )),
        ])}
      </div>
      <HeaderActivityViz />
      <button
        className="tab-resume"
        onClick={onOpenResumePicker}
        title="Resume session (Ctrl+Shift+R)"
      >
        <IconReturn size={16} />
      </button>
      <button
        className="tab-config"
        onClick={onOpenConfigManager}
        title="Config Manager (Ctrl+,)"
      >
        <IconGear size={16} />
      </button>
      <button
        className="tab-add"
        onClick={(event) => event.ctrlKey ? onQuickLaunch() : onOpenLauncher()}
        title={ctrlHeld ? "Quick launch with saved defaults (Ctrl+Shift+T)" : "New session (Ctrl+T)"}
      >
        +
      </button>
    </div>
  );
}
