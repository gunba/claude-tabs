import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "../../store/sessions";
import { useSettingsStore } from "../../store/settings";
import { writeToPty } from "../../lib/ptyRegistry";
import { abbreviatePath, normalizePath, parseWorktreePath } from "../../lib/paths";
import "./NotesPanel.css";

// [NP-01] Per-session notes: Conversation (session metadata) + Project (workspaceNotes store) subtabs. Send-all/Send-selected write to PTY. Buffer not cleared after send.
type SubTab = "conversation" | "project";

function deriveWorkspace(workingDir: string | undefined) {
  if (!workingDir) return { key: "", label: "" };
  const wt = parseWorktreePath(workingDir);
  const projectRoot = wt ? wt.projectRoot : workingDir;
  const key = normalizePath(projectRoot).toLowerCase();
  return { key, label: abbreviatePath(projectRoot) };
}

export function NotesPanel() {
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const sessions = useSessionStore((s) => s.sessions);
  const updateMetadata = useSessionStore((s) => s.updateMetadata);
  const workspaceNotes = useSettingsStore((s) => s.workspaceNotes);
  const setWorkspaceNotes = useSettingsStore((s) => s.setWorkspaceNotes);

  const activeSession = sessions.find((s) => s.id === activeTabId) ?? null;
  const { key: wsKey, label: wsLabel } = useMemo(
    () => deriveWorkspace(activeSession?.config.workingDir),
    [activeSession?.config.workingDir],
  );

  const conversationNotes = activeSession?.metadata.notes ?? "";
  const projectNotes = wsKey ? workspaceNotes[wsKey] ?? "" : "";

  const [subTab, setSubTab] = useState<SubTab>("conversation");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [hasContent, setHasContent] = useState(false);

  const notes = subTab === "conversation" ? conversationNotes : projectNotes;

  // Source change (subtab/session/workspace) reseeds derived state. `notes` is
  // intentionally excluded from deps — it also changes on every keystroke, and
  // resetting selection mid-typing would be wrong. handleInput keeps
  // hasContent in sync between source changes.
  useEffect(() => {
    setHasSelection(false);
    setHasContent(notes.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, subTab, wsKey]);

  const commitNotes = useCallback(
    (value: string) => {
      if (subTab === "conversation") {
        if (activeTabId) updateMetadata(activeTabId, { notes: value });
      } else {
        if (wsKey) setWorkspaceNotes(wsKey, value);
      }
    },
    [subTab, activeTabId, wsKey, updateMetadata, setWorkspaceNotes],
  );

  const refreshSelection = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setHasSelection(false);
      return;
    }
    setHasSelection(el.selectionStart !== el.selectionEnd);
  }, []);

  // Uncontrolled textarea: `defaultValue` seeds it on mount, the browser owns
  // the value (and the undo stack) thereafter. We mirror to the store on every
  // input but never write back into the DOM.
  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const value = e.currentTarget.value;
      commitNotes(value);
      setHasContent(value.length > 0);
      refreshSelection();
    },
    [commitNotes, refreshSelection],
  );

  const sendAll = useCallback(() => {
    if (!activeTabId) return;
    const el = textareaRef.current;
    const value = el ? el.value : notes;
    if (value.length === 0) return;
    writeToPty(activeTabId, value + "\r");
  }, [activeTabId, notes]);

  const sendSelected = useCallback(() => {
    if (!activeTabId) return;
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) return;
    const fragment = el.value.slice(start, end);
    if (fragment.length === 0) return;
    writeToPty(activeTabId, fragment + "\r");
  }, [activeTabId]);

  const subTabs: Array<{ id: SubTab; label: string }> = [
    { id: "conversation", label: "Conversation" },
    { id: "project", label: "Project" },
  ];

  if (!activeTabId || !activeSession) {
    return (
      <div className="notes-panel">
        <div className="notes-panel-subtabs" role="tablist" aria-label="Notes scope">
          {subTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={subTab === t.id}
              className={`notes-panel-subtab${subTab === t.id ? " notes-panel-subtab-active" : ""}`}
              onClick={() => setSubTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="notes-panel-empty">Select a session to take notes.</div>
      </div>
    );
  }

  const projectDisabled = subTab === "project" && !wsKey;
  const canSendAll = hasContent && !projectDisabled;
  const canSendSelected = hasSelection && !projectDisabled;

  const placeholder =
    subTab === "conversation"
      ? "Notes for this conversation."
      : "Notes for this project (shared across all sessions in this workspace).";

  return (
    <div className="notes-panel">
      <div className="notes-panel-subtabs" role="tablist" aria-label="Notes scope">
        {subTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={subTab === t.id}
            className={`notes-panel-subtab${subTab === t.id ? " notes-panel-subtab-active" : ""}`}
            onClick={() => setSubTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {subTab === "project" && (
        <div className="notes-panel-scope" title={wsLabel || undefined}>
          {wsLabel ? `Workspace: ${wsLabel}` : "No workspace detected for this session."}
        </div>
      )}
      <textarea
        // Remount when the underlying buffer changes so `defaultValue`
        // reseeds. While mounted, the browser owns the textarea's value and
        // its undo stack.
        key={`${subTab}|${activeTabId}|${wsKey}`}
        ref={textareaRef}
        className="notes-panel-textarea"
        defaultValue={notes}
        onInput={handleInput}
        onSelect={refreshSelection}
        onKeyUp={refreshSelection}
        onMouseUp={refreshSelection}
        onBlur={refreshSelection}
        placeholder={placeholder}
        spellCheck={false}
        disabled={projectDisabled}
      />
      <div className="notes-panel-actions">
        <button
          type="button"
          className="notes-panel-button"
          onClick={sendSelected}
          disabled={!canSendSelected}
          title="Send the highlighted text to the agent as a user message"
        >
          Send selected
        </button>
        <button
          type="button"
          className="notes-panel-button notes-panel-button-primary"
          onClick={sendAll}
          disabled={!canSendAll}
          title="Send the entire note to the agent as a user message"
        >
          Send all
        </button>
      </div>
    </div>
  );
}
