import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PaneComponentProps } from "./ThreePaneEditor";

/** Tokenize JSON text and wrap tokens in colored spans. */
export function highlightJson(text: string): string {
  // Escape HTML first
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Tokenize: keys, strings, numbers, booleans/null, punctuation
  return escaped.replace(
    /("(?:[^"\\]|\\.)*")\s*:/g,
    '<span class="sh-key">$1</span>:'
  ).replace(
    /:\s*("(?:[^"\\]|\\.)*")/g,
    (match, str) => match.replace(str, `<span class="sh-string">${str}</span>`)
  ).replace(
    // Standalone strings in arrays
    /(?<=[\[,]\s*)("(?:[^"\\]|\\.)*")(?=\s*[,\]])/g,
    '<span class="sh-string">$1</span>'
  ).replace(
    /\b(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g,
    '<span class="sh-number">$1</span>'
  ).replace(
    /\b(true|false|null)\b/g,
    '<span class="sh-bool">$1</span>'
  );
}

export function SettingsPane({ scope, projectDir, onStatus }: PaneComponentProps) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await invoke<string>("read_config_file", {
        scope,
        workingDir: scope === "user" ? "" : projectDir,
        fileType: "settings",
      });
      const formatted = result ? JSON.stringify(JSON.parse(result), null, 2) : "{}";
      setText(formatted);
      setSaved(formatted);
    } catch {
      setText("{}");
      setSaved("{}");
    }
    setLoading(false);
  }, [scope, projectDir]);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(async () => {
    try {
      JSON.parse(text); // validate
    } catch (err) {
      onStatus({ text: `Invalid JSON: ${err}`, type: "error" });
      return;
    }
    try {
      await invoke("write_config_file", {
        scope,
        workingDir: scope === "user" ? "" : projectDir,
        fileType: "settings",
        content: text,
      });
      setSaved(text);
      onStatus({ text: "Settings saved", type: "success" });
      setTimeout(() => onStatus(null), 2000);
    } catch (err) {
      onStatus({ text: `Save failed: ${err}`, type: "error" });
    }
  }, [text, scope, projectDir, onStatus]);

  const syncScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const dirty = text !== saved;

  if (loading) return <div className="pane-hint">Loading...</div>;

  return (
    <div className="pane-editor">
      <div className="sh-container">
        <pre
          ref={preRef}
          className="sh-pre"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlightJson(text) + "\n" }}
        />
        <textarea
          ref={textareaRef}
          className="pane-textarea sh-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          onScroll={syncScroll}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === "s") { e.preventDefault(); handleSave(); }
          }}
        />
      </div>
      <div className="pane-footer">
        <button className="pane-save-btn" onClick={handleSave} disabled={!dirty}>
          {dirty ? "Save" : "Saved"}
        </button>
      </div>
    </div>
  );
}
