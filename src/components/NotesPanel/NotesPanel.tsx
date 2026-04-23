import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "../../store/sessions";
import { writeToPty } from "../../lib/ptyRegistry";
import "./NotesPanel.css";

export function NotesPanel() {
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const sessions = useSessionStore((s) => s.sessions);
  const updateMetadata = useSessionStore((s) => s.updateMetadata);
  const activeSession = sessions.find((s) => s.id === activeTabId) ?? null;
  const notes = activeSession?.metadata.notes ?? "";

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  // Reset selection state on session switch — selection offsets from the
  // previous session's text don't carry meaning for the new one.
  useEffect(() => {
    setHasSelection(false);
  }, [activeTabId]);

  const refreshSelection = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setHasSelection(false);
      return;
    }
    setHasSelection(el.selectionStart !== el.selectionEnd);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!activeTabId) return;
      updateMetadata(activeTabId, { notes: e.target.value });
      refreshSelection();
    },
    [activeTabId, updateMetadata, refreshSelection],
  );

  const sendAll = useCallback(() => {
    if (!activeTabId) return;
    const text = notes;
    if (text.length === 0) return;
    const ok = writeToPty(activeTabId, text + "\r");
    if (!ok) return;
    updateMetadata(activeTabId, { notes: "" });
    setHasSelection(false);
  }, [activeTabId, notes, updateMetadata]);

  const sendSelected = useCallback(() => {
    if (!activeTabId) return;
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) return;
    const fragment = notes.slice(start, end);
    if (fragment.length === 0) return;
    const ok = writeToPty(activeTabId, fragment + "\r");
    if (!ok) return;
    updateMetadata(activeTabId, {
      notes: notes.slice(0, start) + notes.slice(end),
    });
    setHasSelection(false);
  }, [activeTabId, notes, updateMetadata]);

  if (!activeTabId || !activeSession) {
    return (
      <div className="notes-panel">
        <div className="notes-panel-empty">Select a session to take notes.</div>
      </div>
    );
  }

  const canSendAll = notes.length > 0;
  const canSendSelected = hasSelection;

  return (
    <div className="notes-panel">
      <textarea
        ref={textareaRef}
        className="notes-panel-textarea"
        value={notes}
        onChange={handleChange}
        onSelect={refreshSelection}
        onKeyUp={refreshSelection}
        onMouseUp={refreshSelection}
        onBlur={refreshSelection}
        placeholder="Jot notes for this session. Send selected text or the whole buffer to the agent."
        spellCheck={false}
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
