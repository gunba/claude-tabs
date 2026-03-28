import { useState, useRef, useEffect, useCallback } from "react";
import { useSettingsStore } from "../../store/settings";
import { IconClose } from "../Icons/Icons";
import type { StatusMessage } from "../../lib/settingsSchema";

interface PromptsTabProps {
  onStatus: (msg: StatusMessage | null) => void;
}

export function PromptsTab({ onStatus }: PromptsTabProps) {
  const capturedDefaultPrompt = useSettingsStore((s) => s.capturedDefaultPrompt);
  const savedPrompts = useSettingsStore((s) => s.savedPrompts);
  const addSavedPrompt = useSettingsStore((s) => s.addSavedPrompt);
  const updateSavedPrompt = useSettingsStore((s) => s.updateSavedPrompt);
  const removeSavedPrompt = useSettingsStore((s) => s.removeSavedPrompt);

  const [selectedId, setSelectedId] = useState<"default" | string>("default");
  const [editName, setEditName] = useState("");
  const [editText, setEditText] = useState("");
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load selected prompt into editor
  useEffect(() => {
    if (selectedId === "default") {
      setEditName("");
      setEditText(capturedDefaultPrompt || "");
      setDirty(false);
    } else {
      const prompt = savedPrompts.find((p) => p.id === selectedId);
      if (prompt) {
        setEditName(prompt.name);
        setEditText(prompt.text);
        setDirty(false);
      } else {
        // Prompt was deleted — fall back to default
        setSelectedId("default");
      }
    }
  }, [selectedId, capturedDefaultPrompt, savedPrompts]);

  const handleSave = useCallback(() => {
    if (selectedId === "default" || !dirty) return;
    updateSavedPrompt(selectedId, { name: editName, text: editText });
    setDirty(false);
    onStatus({ type: "success", text: "Prompt saved" });
    setTimeout(() => onStatus(null), 2000);
  }, [selectedId, dirty, editName, editText, updateSavedPrompt, onStatus]);

  const handleAdd = useCallback(() => {
    addSavedPrompt("New Prompt", "");
    const newest = useSettingsStore.getState().savedPrompts;
    const last = newest[newest.length - 1];
    if (last) setSelectedId(last.id);
  }, [addSavedPrompt]);

  const handleDelete = useCallback(() => {
    if (selectedId === "default") return;
    removeSavedPrompt(selectedId);
    setSelectedId("default");
  }, [selectedId, removeSavedPrompt]);

  // Ctrl+S save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && dirty && selectedId !== "default") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, selectedId, handleSave]);

  const isDefault = selectedId === "default";

  return (
    <div className="prompts-tab">
      {/* Sidebar */}
      <div className="prompts-sidebar">
        <div className="prompts-list">
          <button
            className={`prompts-list-item${isDefault ? " prompts-list-item-active" : ""}`}
            onClick={() => setSelectedId("default")}
          >
            <span className="prompts-item-name">Default (captured)</span>
            {capturedDefaultPrompt && (
              <span className="prompts-item-size">{capturedDefaultPrompt.length.toLocaleString()} chars</span>
            )}
          </button>

          {savedPrompts.map((p) => (
            <button
              key={p.id}
              className={`prompts-list-item${selectedId === p.id ? " prompts-list-item-active" : ""}`}
              onClick={() => setSelectedId(p.id)}
            >
              <span className="prompts-item-name">{p.name || "Untitled"}</span>
              <span className="prompts-item-size">{p.text.length.toLocaleString()} chars</span>
            </button>
          ))}
        </div>

        <button className="prompts-add-btn" onClick={handleAdd}>
          + Add Prompt
        </button>
      </div>

      {/* Editor */}
      <div className="prompts-editor">
        {isDefault ? (
          <>
            <div className="prompts-editor-header">
              <span className="prompts-editor-title">Default System Prompt</span>
              <span className="prompts-editor-badge">read-only</span>
            </div>
            {capturedDefaultPrompt ? (
              <textarea
                className="prompts-textarea"
                value={capturedDefaultPrompt}
                readOnly
                ref={textareaRef}
              />
            ) : (
              <div className="prompts-empty">
                No prompt captured yet — start a session to capture the default system prompt.
              </div>
            )}
            {capturedDefaultPrompt && (
              <div className="prompts-editor-footer">
                <span className="prompts-char-count">
                  {capturedDefaultPrompt.length.toLocaleString()} characters
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="prompts-editor-header">
              <input
                className="prompts-name-input"
                value={editName}
                onChange={(e) => { setEditName(e.target.value); setDirty(true); }}
                placeholder="Prompt name"
                spellCheck={false}
              />
              <div className="prompts-editor-actions">
                {dirty && (
                  <button className="prompts-save-btn" onClick={handleSave}>
                    Save
                  </button>
                )}
                <button className="prompts-delete-btn" onClick={handleDelete} title="Delete prompt">
                  <IconClose size={12} />
                </button>
              </div>
            </div>
            <textarea
              className="prompts-textarea"
              value={editText}
              onChange={(e) => { setEditText(e.target.value); setDirty(true); }}
              ref={textareaRef}
              placeholder="Enter your system prompt..."
              spellCheck={false}
            />
            <div className="prompts-editor-footer">
              <span className="prompts-char-count">
                {editText.length.toLocaleString()} characters
              </span>
              {dirty && <span className="prompts-unsaved">unsaved</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
