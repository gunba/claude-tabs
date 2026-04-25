import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import type { PaneComponentProps } from "./ThreePaneEditor";
import { insertTextAtCursor } from "../../lib/domEdit";
import "./MarkdownPane.css";

// [CM-14] Scope-to-fileType mapping.
const CLAUDE_SCOPE_TO_FILETYPE: Record<string, string> = {
  user: "claudemd-user",
  project: "claudemd-root",
  "project-local": "claudemd-local",
};

const CODEX_SCOPE_TO_FILETYPE: Record<string, string> = {
  user: "agentsmd-user",
  project: "agentsmd-root",
  "project-local": "agentsmd-local",
};

export function MarkdownPane({ scope, projectDir, cli, onStatus }: PaneComponentProps) {
  const [saved, setSaved] = useState("");
  const [current, setCurrent] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [seedKey, setSeedKey] = useState(0);

  const fileType = (cli === "codex" ? CODEX_SCOPE_TO_FILETYPE : CLAUDE_SCOPE_TO_FILETYPE)[scope];
  const docName = cli === "codex" ? "AGENTS.md" : "CLAUDE.md";

  const load = useCallback(async () => {
    let result = "";
    try {
      result = await invoke<string>("read_config_file", {
        scope,
        workingDir: scope === "user" ? "" : projectDir,
        fileType,
      });
    } catch {
      result = "";
    }
    setSaved(result);
    setCurrent(result);
    setSeedKey((k) => k + 1);
    setLoading(false);
  }, [scope, projectDir, fileType]);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(async () => {
    const value = textareaRef.current?.value ?? current;
    try {
      await invoke("write_config_file", {
        scope,
        workingDir: scope === "user" ? "" : projectDir,
        fileType,
        content: value,
      });
      setSaved(value);
      onStatus({ text: `${docName} saved`, type: "success" });
      setTimeout(() => onStatus(null), 2000);
    } catch (err) {
      onStatus({ text: `Save failed: ${err}`, type: "error" });
    }
  }, [current, scope, projectDir, fileType, docName, onStatus]);

  const dirty = current !== saved;

  if (loading) return <div className="pane-hint">Loading...</div>;

  return (
    <div className="pane-editor">
      {preview ? (
        <div className="md-preview">
          <ReactMarkdown>{current || "*No content*"}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          // Remount on each successful load so `defaultValue` reseeds. Mid-edit
          // the browser owns the value and the native undo stack.
          key={seedKey}
          ref={textareaRef}
          className="pane-textarea pane-textarea-md"
          defaultValue={current}
          onInput={(e) => setCurrent(e.currentTarget.value)}
          spellCheck={false}
          placeholder={`No ${docName} found - type to create`}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === "s") { e.preventDefault(); handleSave(); }
            if (e.key === "Tab") {
              e.preventDefault();
              insertTextAtCursor(e.currentTarget, "  ");
            }
          }}
        />
      )}
      <div className="pane-footer">
        <button // [CM-23] Preview/Edit toggle with ReactMarkdown rendering
          className={`pane-preview-btn${preview ? " pane-preview-btn-active" : ""}`}
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Edit" : "Preview"}
        </button>
        <button className="pane-save-btn" onClick={handleSave} disabled={!dirty}>
          {dirty ? "Save" : "Saved"}
        </button>
      </div>
    </div>
  );
}
