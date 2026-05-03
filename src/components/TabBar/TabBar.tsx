import { useRef, useState, type DragEvent } from "react";
import { HeaderActivityViz } from "../HeaderActivityViz/HeaderActivityViz";
import { IconFolder, IconGear, IconReturn } from "../Icons/Icons";
import {
  computeGroupReorder,
  computeTabReorder,
  sideFromMidpoint,
  type TabGroup,
} from "../../lib/paths";
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

type DragSource =
  | { kind: "tab"; id: string }
  | { kind: "group"; key: string };

type Side = "before" | "after";

const DRAG_MIME = "application/x-code-tabs-drag";

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
  const dragSourceRef = useRef<DragSource | null>(null);
  const [tabDropTarget, setTabDropTarget] = useState<{ id: string; side: Side } | null>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<{ key: string; side: Side } | null>(null);

  const clearDragState = () => {
    dragSourceRef.current = null;
    setTabDropTarget(null);
    setGroupDropTarget(null);
  };

  const primeDragTransfer = (event: DragEvent<HTMLDivElement>, kind: DragSource["kind"], label: string) => {
    const payload = label || kind;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, kind);
    event.dataTransfer.setData("text/plain", payload);

    const ghost = document.createElement("div");
    ghost.textContent = payload;
    ghost.style.cssText = "position:absolute;top:-999px;padding:4px 8px;background:var(--bg-surface);color:var(--text-primary);font-size:11px;border-radius:4px;white-space:nowrap;";
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 0, 0);
    requestAnimationFrame(() => ghost.remove());
  };

  const sideFromEvent = (event: DragEvent<HTMLDivElement>): Side =>
    sideFromMidpoint(event.clientX, event.currentTarget.getBoundingClientRect());

  // ── Tab drag (within-group reorder) ───────────────────────────

  const handleTabDragStart = (
    event: DragEvent<HTMLDivElement>,
    session: Session,
    fullName: string,
  ) => {
    dragSourceRef.current = { kind: "tab", id: session.id };
    primeDragTransfer(event, "tab", fullName);
  };

  const handleTabDragOver = (event: DragEvent<HTMLDivElement>, session: Session) => {
    event.preventDefault();
    const source = dragSourceRef.current;
    if (source?.kind !== "tab") return;
    const side = sideFromEvent(event);
    const order = regularSessions.map((s) => s.id);
    if (!computeTabReorder(order, source.id, session.id, side, groups)) return;
    event.dataTransfer.dropEffect = "move";
    setTabDropTarget((prev) =>
      prev?.id === session.id && prev.side === side ? prev : { id: session.id, side },
    );
  };

  const handleTabDrop = (session: Session) => {
    const drop = tabDropTarget;
    const source = dragSourceRef.current;
    setTabDropTarget(null);
    dragSourceRef.current = null;
    if (source?.kind !== "tab" || !drop || drop.id !== session.id) return;
    const next = computeTabReorder(
      regularSessions.map((s) => s.id),
      source.id,
      session.id,
      drop.side,
      groups,
    );
    if (next) onReorderTabs(next);
  };

  // ── Group drag (whole-group reorder) ──────────────────────────

  const handleGroupDragStart = (event: DragEvent<HTMLDivElement>, group: TabGroup) => {
    dragSourceRef.current = { kind: "group", key: group.key };
    primeDragTransfer(event, "group", group.label);
  };

  const handleGroupDragOver = (event: DragEvent<HTMLDivElement>, group: TabGroup) => {
    event.preventDefault();
    const source = dragSourceRef.current;
    if (source?.kind !== "group") return;
    const side = sideFromEvent(event);
    const order = regularSessions.map((s) => s.id);
    if (!computeGroupReorder(order, source.key, group.key, side, groups)) return;
    event.dataTransfer.dropEffect = "move";
    setGroupDropTarget((prev) =>
      prev?.key === group.key && prev.side === side ? prev : { key: group.key, side },
    );
  };

  const handleGroupDrop = (group: TabGroup) => {
    const drop = groupDropTarget;
    const source = dragSourceRef.current;
    setGroupDropTarget(null);
    dragSourceRef.current = null;
    if (source?.kind !== "group" || !drop || drop.key !== group.key) return;
    const next = computeGroupReorder(
      regularSessions.map((s) => s.id),
      source.key,
      group.key,
      drop.side,
      groups,
    );
    if (next) onReorderTabs(next);
  };

  return (
    <div className="tab-bar">
      <div className="tab-bar-scroll">
        {groups.flatMap((group) => [
          <div
            key={`hdr-${group.key}`}
            className={`tab-group-header${groupDropTarget?.key === group.key ? ` tab-group-drop-${groupDropTarget.side}` : ""}`}
            style={{ ["--tab-count" as string]: group.sessions.length }}
            title={group.fullPath}
            draggable
            onDragStart={(event) => handleGroupDragStart(event, group)}
            onDragOver={(event) => handleGroupDragOver(event, group)}
            onDrop={() => handleGroupDrop(group)}
            onDragEnd={clearDragState}
          >
            <IconFolder size={10} className="tab-group-header-icon" />
            <span className="tab-group-header-label">{group.label}</span>
          </div>,
          ...group.sessions.map((session) => (
            <Tab
              key={session.id}
              session={session}
              subagents={subagentMap.get(session.id) || []}
              activeTabId={activeTabId}
              ctrlHeld={ctrlHeld}
              dropSide={tabDropTarget?.id === session.id ? tabDropTarget.side : null}
              settledKind={settledTabs.get(session.id)}
              inspectorOff={inspectorOffSessions.has(session.id)}
              onActivate={onActivate}
              onClose={onCloseSession}
              onRequestKill={onRequestKill}
              onRelaunchWithOptions={onRelaunchWithOptions}
              onOpenContextMenu={onOpenContextMenu}
              onClearSettled={onClearSettled}
              onDragStart={handleTabDragStart}
              onDragOver={handleTabDragOver}
              onDrop={handleTabDrop}
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
