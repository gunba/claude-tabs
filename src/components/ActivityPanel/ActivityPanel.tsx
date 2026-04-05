import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActivityStore } from "../../store/activity";
import { useSessionStore } from "../../store/sessions";
import { ClaudeMascot } from "./ClaudeMascot";
import type { MascotState } from "./ClaudeMascot";
import { IconClose, IconFolder, IconDocument } from "../Icons/Icons";
import { isSubagentActive } from "../../types/session";
import type { FileActivity, ContextFileEntry } from "../../types/activity";
import { buildFileTree, flattenTree, allFolderPaths } from "../../lib/fileTree";
import type { FileTreeNode } from "../../lib/fileTree";
import { canonicalizePath } from "../../lib/paths";
import "./ActivityPanel.css";

interface ActivityPanelProps {
  onClose: () => void;
}

type ViewMode = "response" | "session";

const INDENT_STEP = 16;
/** X-offset within each indent column where vertical guide lines are drawn. */
const GUIDE_LINE_X = 6;
// [AP-04] Floating mascot travels to active file; guide lines at INDENT_STEP=16/GUIDE_LINE_X=6
// [AP-05] Two view modes: Response (since lastUserMessageAt) and Session (all visited paths)

/* -- Helpers -- */

function extractPathFromAction(action: string): string | null {
  const colonIdx = action.indexOf(": ");
  if (colonIdx === -1) return null;
  return action.slice(colonIdx + 2);
}

const FILE_TOOLS = new Set(["Read", "Write", "Edit", "NotebookEdit"]);

function toolToMascotState(toolName: string): MascotState {
  if (toolName === "Read") return "reading";
  if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") return "writing";
  return "idle";
}

interface AgentOnFile {
  toolName: string;
  isSubagent: boolean;
  agentId: string | null;
}

/**
 * Build a CSS repeating-linear-gradient string that draws vertical guide
 * lines at each indent level.
 */
function guideGradient(depth: number): string | undefined {
  if (depth <= 0) return undefined;
  return `repeating-linear-gradient(to right, transparent 0px, transparent ${GUIDE_LINE_X}px, var(--border) ${GUIDE_LINE_X}px, var(--border) ${GUIDE_LINE_X + 1}px, transparent ${GUIDE_LINE_X + 1}px, transparent ${INDENT_STEP}px)`;
}

/* -- Empty panel -- */

function EmptyPanel({ onClose, message }: { onClose: () => void; message: string }) {
  return (
    <div className="activity-panel">
      <div className="activity-panel-header">
        <span className="activity-panel-title">Activity</span>
        <span className="activity-panel-spacer" />
        <button className="activity-panel-close" onClick={onClose} title="Close (Esc)">
          <IconClose size={14} />
        </button>
      </div>
      <div className="activity-panel-empty">{message}</div>
    </div>
  );
}

/* -- Tree row component -- */

function FileTreeRow({
  node,
  depth,
  isExpanded,
  onToggle,
  agents,
  contextInfo,
  onFileClick,
  showMascotInline,
}: {
  node: FileTreeNode;
  depth: number;
  isExpanded: boolean;
  onToggle: (path: string) => void;
  agents: AgentOnFile[];
  contextInfo: ContextFileEntry | null;
  onFileClick: (path: string) => void;
  /** Whether to show the inline mascot (false when floating mascot covers this file). */
  showMascotInline: boolean;
}) {
  const indent = depth * INDENT_STEP;
  const primaryMascot = agents.length > 0 ? agents[0] : null;
  const extraAgentCount = agents.length > 1 ? agents.length - 1 : 0;
  const mascotState = primaryMascot ? toolToMascotState(primaryMascot.toolName) : null;

  const tooltip = contextInfo
    ? `${node.fullPath}\nContext: ${contextInfo.memoryType} (${contextInfo.loadReason})`
    : node.fullPath;

  // Guide line background
  const bg = guideGradient(depth);
  const guideStyle: React.CSSProperties = {
    paddingLeft: indent + (node.isFile ? 4 : 0),
    ...(bg && {
      backgroundImage: bg,
      backgroundSize: `${indent}px 100%`,
      backgroundRepeat: "no-repeat",
    }),
    ...(node.isFile && depth > 0 && { "--guide-left": `${indent}px` } as React.CSSProperties),
  };

  // State indicator class for file kind
  const kindClass = node.activity?.kind && node.activity.kind !== "read"
    ? ` file-tree-kind-${node.activity.kind}`
    : "";

  if (node.isFile) {
    // Show inline mascot only for subagent files (floating mascot handles the main agent)
    const inlineMascot = showMascotInline && mascotState && primaryMascot;

    return (
      <div
        className={`file-tree-row file-tree-file${depth > 0 ? " file-tree-guided" : ""}`}
        style={guideStyle}
        onClick={() => onFileClick(node.fullPath)}
        title={tooltip}
        data-path={node.fullPath}
      >
        <span className="file-tree-icon-slot">
          {inlineMascot ? (
            <ClaudeMascot
              state={mascotState!}
              isSubagent={primaryMascot!.isSubagent}
              size={16}
            />
          ) : (
            <IconDocument size={14} />
          )}
        </span>
        <span className={`file-tree-name file-tree-filename${kindClass}`}>{node.name}</span>
        {extraAgentCount > 0 && (
          <span className="file-tree-agent-count">+{extraAgentCount}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className="file-tree-row file-tree-folder"
      style={guideStyle}
      onClick={() => onToggle(node.fullPath)}
      title={node.fullPath}
    >
      <span className={`file-tree-chevron${isExpanded ? "" : " collapsed"}`}>
        {"\u25BE"}
      </span>
      <span className="file-tree-icon-slot">
        <IconFolder size={14} />
      </span>
      <span className="file-tree-name file-tree-foldername">{node.name}</span>
    </div>
  );
}

/* -- Sticky mascot state -- */

interface StickyMascot {
  path: string;
  state: MascotState;
  isSubagent: boolean;
  top: number;
  left: number;
}

/* -- Main panel -- */

export function ActivityPanel({ onClose }: ActivityPanelProps) {
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const sessions = useSessionStore((s) => s.sessions);
  const storeSubagents = useSessionStore((s) => s.subagents);
  const activeSession = sessions.find((s) => s.id === activeTabId);

  const activity = useActivityStore((s) => activeTabId ? s.sessions[activeTabId] ?? null : null);

  const [mode, setMode] = useState<ViewMode>("response");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Floating/sticky mascot
  const containerRef = useRef<HTMLDivElement>(null);
  const [mascot, setMascot] = useState<StickyMascot | null>(null);

  // Reset on session switch
  useEffect(() => {
    setExpandedPaths(new Set());
    setMascot(null);
  }, [activeTabId]);

  // Build map of file paths currently being worked on by agents
  const activeAgentFiles = useMemo(() => {
    const map = new Map<string, AgentOnFile[]>();
    if (!activeSession) return map;

    const pushAgent = (path: string, agent: AgentOnFile) => {
      const existing = map.get(path);
      if (existing) {
        existing.push(agent);
      } else {
        map.set(path, [agent]);
      }
    };

    // Main agent
    const meta = activeSession.metadata;
    if (meta.currentAction && meta.currentToolName && FILE_TOOLS.has(meta.currentToolName)) {
      const path = extractPathFromAction(meta.currentAction);
      if (path) {
        pushAgent(canonicalizePath(path), { toolName: meta.currentToolName, isSubagent: false, agentId: null });
      }
    }

    // Subagents
    const subs = activeTabId ? storeSubagents.get(activeTabId) ?? [] : [];
    for (const sub of subs) {
      if (!isSubagentActive(sub.state)) continue;
      if (sub.currentAction && sub.currentToolName && FILE_TOOLS.has(sub.currentToolName)) {
        const path = extractPathFromAction(sub.currentAction);
        if (path) {
          pushAgent(canonicalizePath(path), { toolName: sub.currentToolName, isSubagent: true, agentId: sub.id });
        }
      }
    }

    return map;
  }, [
    activeSession?.metadata.currentAction,
    activeSession?.metadata.currentToolName,
    activeTabId,
    storeSubagents,
  ]);

  // Find the primary active file (main agent, not subagent)
  const primaryActive = useMemo(() => {
    for (const [path, agents] of activeAgentFiles) {
      const mainAgent = agents.find((a) => !a.isSubagent);
      if (mainAgent) return { path, agent: mainAgent };
    }
    return null;
  }, [activeAgentFiles]);

  // Build context file lookup by path
  const contextFileMap = useMemo(() => {
    const map = new Map<string, ContextFileEntry>();
    if (!activity) return map;
    for (const cf of activity.contextFiles) {
      map.set(cf.path, cf);
    }
    return map;
  }, [activity?.contextFiles]);

  // Derive the file set based on mode
  const fileMap = useMemo(() => {
    const map = new Map<string, FileActivity>();
    if (!activity) return map;

    if (mode === "response") {
      const boundary = activity.lastUserMessageAt;
      for (const turn of activity.turns) {
        if (turn.startedAt >= boundary) {
          for (const f of turn.files) {
            map.set(f.path, f);
          }
        }
      }
    } else {
      for (const path of activity.visitedPaths) {
        const entry = activity.allFiles[path];
        if (entry) {
          map.set(path, entry);
        } else {
          map.set(path, {
            path,
            kind: "read",
            agentId: null,
            toolName: null,
            timestamp: 0,
            confirmed: true,
            isExternal: false,
            permissionDenied: false,
            permissionMode: null,
            toolInputData: null,
          });
        }
      }
    }

    return map;
  }, [activity, mode]);

  // Build the tree with workspace-relative paths
  const workspaceDir = activeSession?.config.workingDir ?? "";
  const tree = useMemo(
    () => buildFileTree(fileMap, canonicalizePath(workspaceDir)),
    [fileMap, workspaceDir],
  );

  // Auto-expand new folders when tree changes
  useEffect(() => {
    if (tree.length === 0) return;
    const newFolders = allFolderPaths(tree);
    setExpandedPaths((prev) => {
      const merged = new Set(prev);
      for (const path of newFolders) {
        merged.add(path);
      }
      return merged;
    });
  }, [tree]);

  // Flatten for rendering
  const rows = useMemo(() => flattenTree(tree, expandedPaths), [tree, expandedPaths]);

  // Find depth of a given path in the current rows
  const depthByPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.node.fullPath, row.depth);
    }
    return map;
  }, [rows]);

  // Update floating mascot position when active file changes or persists at last position
  useEffect(() => {
    if (!containerRef.current) return;

    if (primaryActive) {
      // Agent is actively working on a file — move mascot there with active animation
      const rowEl = containerRef.current.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(primaryActive.path)}"]`,
      );
      if (!rowEl) {
        // Target row not visible (e.g. folder collapsed) — clear stale mascot
        setMascot(null);
        return;
      }

      const depth = depthByPath.get(primaryActive.path) ?? 0;
      const containerRect = containerRef.current.getBoundingClientRect();
      const rowRect = rowEl.getBoundingClientRect();
      const scrollTop = containerRef.current.scrollTop;

      setMascot({
        path: primaryActive.path,
        state: toolToMascotState(primaryActive.agent.toolName),
        isSubagent: false,
        top: rowRect.top - containerRect.top + scrollTop + rowRect.height / 2 - 8,
        left: 8 + depth * INDENT_STEP - INDENT_STEP + GUIDE_LINE_X - 3,
      });
    } else if (mascot) {
      // No active tool call — keep mascot at last position but switch to idle
      setMascot((prev) => prev ? { ...prev, state: "idle" } : null);
    }
  }, [primaryActive, depthByPath]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleFileClick = useCallback((filePath: string) => {
    invoke("shell_open", { path: filePath }).catch(() => {});
  }, []);

  if (!activeSession) return <EmptyPanel onClose={onClose} message="No active session" />;
  if (activeSession.state === "dead") return <EmptyPanel onClose={onClose} message="Session ended" />;

  return (
    <div className="activity-panel">
      <div className="activity-panel-header">
        <span className="activity-panel-title">Activity</span>
        <div className="activity-mode-toggle">
          <button
            className={`activity-mode-btn${mode === "response" ? " active" : ""}`}
            onClick={() => setMode("response")}
          >
            Response
          </button>
          <button
            className={`activity-mode-btn${mode === "session" ? " active" : ""}`}
            onClick={() => setMode("session")}
          >
            Session
          </button>
        </div>
        <span className="activity-panel-spacer" />
        <button className="activity-panel-close" onClick={onClose} title="Close (Esc)">
          <IconClose size={14} />
        </button>
      </div>

      <div className="activity-panel-body activity-tree-container" ref={containerRef}>
        {rows.length === 0 ? (
          <div className="activity-panel-empty">
            {mode === "response" ? "No activity yet" : "No files visited"}
          </div>
        ) : (
          <>
            {rows.map((row) => {
              const agents = activeAgentFiles.get(row.node.fullPath) ?? [];
              // Only show inline mascot for subagent files — the floating mascot handles
              // main agent files (including the sticky idle state between actions)
              const isFloatingTarget = mascot?.path === row.node.fullPath;
              const subagentOnly = agents.filter((a) => a.isSubagent);

              return (
                <FileTreeRow
                  key={row.key}
                  node={row.node}
                  depth={row.depth}
                  isExpanded={expandedPaths.has(row.node.fullPath)}
                  onToggle={toggleFolder}
                  agents={isFloatingTarget ? subagentOnly : agents}
                  contextInfo={row.node.isFile ? contextFileMap.get(row.node.fullPath) ?? null : null}
                  onFileClick={handleFileClick}
                  showMascotInline={!isFloatingTarget}
                />
              );
            })}
            {mascot && (
              <div
                className="activity-mascot-float"
                style={{ top: mascot.top, left: mascot.left }}
              >
                <ClaudeMascot
                  state={mascot.state}
                  isSubagent={mascot.isSubagent}
                  size={16}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
