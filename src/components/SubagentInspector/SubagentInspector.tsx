import { memo, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import type { CapturedMessage, Subagent, SubagentMessage } from "../../types/session";
import { isSubagentActive } from "../../types/session";
import { splitFilePath } from "../../lib/paths";
import { useSessionStore } from "../../store/sessions";
import "./SubagentInspector.css";

interface SubagentInspectorProps {
  subagent: Subagent;
  onClose: () => void;
}

function getToolPreview(text: string): string {
  const firstLine = text.split("\n").find(line => line.trim().length > 0) ?? "";
  const trimmed = firstLine.trim();
  return trimmed;
}

// [IN-35] Codex child rollouts load on inspector open and render as retained subagent messages.
interface CodexThreadInspectorPayload {
  messages: CapturedMessage[];
  completed: boolean;
  lastAgentMessage: string | null;
  durationMs: number | null;
}

function normalizeCodexToolName(name: string): string {
  return name === "shell" || name === "exec_command" || name === "shell_command" || name === "local_shell"
    ? "Bash"
    : name;
}

function codexToolInput(name: string, input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const parsed = input as Record<string, unknown>;
  if (normalizeCodexToolName(name) !== "Bash") return parsed;
  const command = typeof parsed.cmd === "string"
    ? parsed.cmd
    : typeof parsed.command === "string" ? parsed.command : "";
  return { ...parsed, command, description: "Codex command" };
}

function codexCapturedToSubagentMessages(messages: CapturedMessage[]): SubagentMessage[] {
  const out: SubagentMessage[] = [];
  for (const message of messages) {
    for (const block of message.content) {
      if (message.role === "assistant" && block.type === "text" && block.text) {
        out.push({ role: "assistant", text: block.text, timestamp: Date.now() });
      } else if (message.role === "assistant" && block.type === "tool_use") {
        const rawName = block.name || "tool";
        const toolName = normalizeCodexToolName(rawName);
        const toolInput = codexToolInput(rawName, block.input);
        const command = toolInput && typeof toolInput.command === "string" ? toolInput.command : null;
        const text = command || `${rawName}: ${JSON.stringify(block.input ?? {})}`;
        out.push({ role: "tool", text, toolName, toolInput, timestamp: Date.now() });
      } else if (message.role === "user" && block.type === "tool_result" && block.text) {
        out.push({ role: "tool", text: block.text, toolName: "result", timestamp: Date.now() });
      }
    }
  }
  return out;
}

// ── Tool-specific renderers ──

function FileHeader({ toolName, filePath }: { toolName: string; filePath: string }) {
  const { dir, name } = splitFilePath(filePath);
  return (
    <div className="inspector-tool-file-header">
      <span className="inspector-tool-file-tool">{toolName}</span>
      <span className="inspector-tool-file-path">
        <span className="inspector-tool-file-dir">{dir}</span>
        <span className="inspector-tool-file-name">{name}</span>
      </span>
    </div>
  );
}

function EditRenderer({ msg }: { msg: SubagentMessage }) {
  const input = msg.toolInput;
  if (!input) return null;
  const filePath = String(input.file_path || "");
  const oldStr = String(input.old_string ?? "");
  const newStr = String(input.new_string ?? "");
  const oldLines = oldStr ? oldStr.replace(/\n$/, "").split("\n") : [];
  const newLines = newStr ? newStr.replace(/\n$/, "").split("\n") : [];
  const removed = oldLines.length;
  const added = newLines.length;

  return (
    <div className="inspector-edit-block">
      <FileHeader toolName="Edit" filePath={filePath} />
      <div className="inspector-edit-summary">
        {added > 0 && <span className="inspector-edit-added">+{added}</span>}
        {removed > 0 && <span className="inspector-edit-removed">-{removed}</span>}
      </div>
      <div className="inspector-diff">
        {oldStr && oldLines.map((line, i) => (
          <div key={`d${i}`} className="inspector-diff-line inspector-diff-del">
            <span className="inspector-diff-prefix">-</span>
            <span className="inspector-diff-content">{line}</span>
          </div>
        ))}
        {newStr && newLines.map((line, i) => (
          <div key={`a${i}`} className="inspector-diff-line inspector-diff-add">
            <span className="inspector-diff-prefix">+</span>
            <span className="inspector-diff-content">{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BashRenderer({ msg }: { msg: SubagentMessage }) {
  const input = msg.toolInput;
  const command = input ? String(input.command || msg.text) : msg.text;
  const description = input?.description ? String(input.description) : null;
  return (
    <div className="inspector-bash-block">
      <FileHeader toolName="Bash" filePath={description || command.slice(0, 60)} />
      <div className="inspector-bash-cmd">
        <span className="inspector-bash-prompt">$</span>
        <span className="inspector-bash-text">{command}</span>
      </div>
    </div>
  );
}

function FileToolRenderer({ msg, toolName }: { msg: SubagentMessage; toolName: string }) {
  const input = msg.toolInput;
  const filePath = input ? String(input.file_path || input.pattern || msg.text) : msg.text;
  return (
    <div className="inspector-file-block">
      <FileHeader toolName={toolName} filePath={filePath} />
    </div>
  );
}

function SearchRenderer({ msg, toolName }: { msg: SubagentMessage; toolName: string }) {
  const input = msg.toolInput;
  const pattern = input ? String(input.pattern || msg.text) : msg.text;
  const path = input?.path ? String(input.path) : null;
  return (
    <div className="inspector-search-block">
      <div className="inspector-tool-file-header">
        <span className="inspector-tool-file-tool">{toolName}</span>
        <span className="inspector-tool-file-path">
          <span className="inspector-tool-file-name">{pattern}</span>
          {path && <span className="inspector-tool-file-dir"> in {path}</span>}
        </span>
      </div>
    </div>
  );
}

// [IN-08] [TR-12] Tool block collapse: React.memo, collapsed by default, click to expand
const MessageBlock = memo(function MessageBlock({ msg, defaultExpanded }: { msg: SubagentMessage; defaultExpanded: boolean }) {
  const [collapsed, setCollapsed] = useState(!defaultExpanded);

  if (msg.role === "assistant") {
    return (
      <div className="inspector-msg inspector-msg-assistant">
        <ReactMarkdown>{msg.text}</ReactMarkdown>
      </div>
    );
  }

  // Tool-specific rendering when structured input is available
  if (msg.toolInput) {
    const tn = msg.toolName;
    if (tn === "Edit") return <EditRenderer msg={msg} />;
    if (tn === "Bash") return <BashRenderer msg={msg} />;
    if (tn === "Read" || tn === "Write") return <FileToolRenderer msg={msg} toolName={tn} />;
    if (tn === "Grep" || tn === "Glob") return <SearchRenderer msg={msg} toolName={tn} />;
  }

  // Fallback: collapsible text block
  const label = msg.toolName === "result"
    ? <span className="inspector-tool-result-label">result</span>
    : msg.toolName
      ? <span className="inspector-tool-name">{msg.toolName}</span>
      : null;

  return (
    <div
      className={`inspector-msg inspector-msg-tool${collapsed ? " inspector-msg-tool-collapsed" : ""}`}
      onClick={() => setCollapsed(c => !c)}
    >
      <div className="inspector-tool-header">
        <span className="inspector-tool-toggle">{collapsed ? "\u25b8" : "\u25be"}</span>
        {label}
        {collapsed && <span className="inspector-tool-preview">{getToolPreview(msg.text)}</span>}
      </div>
      {!collapsed && <pre className="inspector-msg-text">{msg.text}</pre>}
    </div>
  );
}, (prev, next) => prev.msg === next.msg);

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="inspector-section-divider">
      <span className="inspector-section-line" />
      <span className="inspector-section-label">{label}</span>
      <span className="inspector-section-line" />
    </div>
  );
}

export function SubagentInspector({ subagent, onClose }: SubagentInspectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(subagent.messages.length);
  const prevResultRef = useRef(subagent.resultText);
  const [promptCollapsed, setPromptCollapsed] = useState(!!subagent.resultText);
  const [codexPayload, setCodexPayload] = useState<CodexThreadInspectorPayload | null>(null);
  const updateSubagent = useSessionStore((s) => s.updateSubagent);

  useEffect(() => {
    if (!/^019[0-9a-f-]{33}$/i.test(subagent.id)) {
      setCodexPayload(null);
      return;
    }
    let cancelled = false;
    invoke<CodexThreadInspectorPayload>("read_codex_thread_inspector", { threadId: subagent.id })
      .then((payload) => {
        if (!cancelled) setCodexPayload(payload);
      })
      .catch(() => {
        if (!cancelled) setCodexPayload(null);
      });
    return () => { cancelled = true; };
  }, [subagent.id]);

  const loadedCodexMessages = useMemo(
    () => codexPayload ? codexCapturedToSubagentMessages(codexPayload.messages) : null,
    [codexPayload],
  );
  const loadedResultText = codexPayload?.lastAgentMessage || subagent.resultText;
  const lastLoadedMessage = loadedCodexMessages ? loadedCodexMessages[loadedCodexMessages.length - 1] : undefined;
  const displayMessages = loadedCodexMessages && loadedResultText && lastLoadedMessage?.role === "assistant" && lastLoadedMessage.text === loadedResultText
    ? loadedCodexMessages.slice(0, -1)
    : loadedCodexMessages ?? subagent.messages;
  const displaySubagent: Subagent = codexPayload
    ? {
        ...subagent,
        messages: displayMessages,
        resultText: loadedResultText,
        durationMs: codexPayload.durationMs ?? subagent.durationMs,
        completed: codexPayload.completed || subagent.completed,
        state: codexPayload.completed ? "dead" : subagent.state,
      }
    : subagent;

  useEffect(() => {
    if (!codexPayload?.completed) return;
    updateSubagent(subagent.parentSessionId, subagent.id, {
      state: "dead",
      completed: true,
      durationMs: codexPayload.durationMs ?? subagent.durationMs,
      resultText: loadedResultText || undefined,
    });
  }, [codexPayload, loadedResultText, subagent.durationMs, subagent.id, subagent.parentSessionId, updateSubagent]);

  const isActive = isSubagentActive(displaySubagent.state);

  // Scroll to bottom on new messages (during active execution)
  useEffect(() => {
    if (displaySubagent.messages.length > prevLenRef.current && scrollRef.current && isActive) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLenRef.current = displaySubagent.messages.length;
  }, [displaySubagent.messages.length, isActive]);

  // Scroll to result when it first appears
  useEffect(() => {
    if (displaySubagent.resultText && !prevResultRef.current && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      setPromptCollapsed(true);
    }
    prevResultRef.current = displaySubagent.resultText;
  }, [displaySubagent.resultText]);

  // Scroll to bottom on open
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const lastToolIndex = isActive
    ? displaySubagent.messages.reduce((acc, m, idx) => m.role === "tool" ? idx : acc, -1)
    : -1;

  // Build metadata string
  const metaParts: string[] = [];
  const typeLabel = displaySubagent.subagentType || displaySubagent.agentType;
  if (typeLabel) metaParts.push(typeLabel);
  if (displaySubagent.model) metaParts.push(displaySubagent.model.replace(/^claude-/, "").split("-")[0]);
  if (displaySubagent.totalToolUses != null) metaParts.push(`${displaySubagent.totalToolUses} tools`);
  if (displaySubagent.durationMs != null) metaParts.push(`${Math.round(displaySubagent.durationMs / 1000)}s`);
  if (displaySubagent.messages.length > 0) metaParts.push(`${displaySubagent.messages.length} msgs`);

  return (
    <div className="inspector-overlay" data-modal-overlay>
      <div className="inspector-header">
        <span className="inspector-header-status">
          {displaySubagent.completed
            ? <span className="inspector-status-done">{"\u2713"}</span>
            : <span className={`inspector-status-dot state-${displaySubagent.state}`} />
          }
        </span>
        <span className="inspector-header-desc">{displaySubagent.description}</span>
        {metaParts.length > 0 && (
          <span className="inspector-header-meta">{metaParts.join(" \u00b7 ")}</span>
        )}
        <button className="inspector-header-close" onClick={onClose}>Esc</button>
      </div>

      <div className="inspector-body" ref={scrollRef}>
        {/* [TA-08] Terminal-style lifecycle viewer: prompt, conversation, result, and pending states. */}
        {/* Prompt section */}
        {displaySubagent.promptText && (
          <>
            <div
              className="inspector-section-divider inspector-section-clickable"
              onClick={() => setPromptCollapsed(c => !c)}
            >
              <span className="inspector-section-line" />
              <span className="inspector-section-label">
                {promptCollapsed ? "\u25b8" : "\u25be"} Prompt
              </span>
              <span className="inspector-section-line" />
            </div>
            {!promptCollapsed && (
              <div className="inspector-prompt">
                <pre className="inspector-prompt-text">{displaySubagent.promptText}</pre>
              </div>
            )}
          </>
        )}

        {/* Conversation section */}
        {displaySubagent.messages.length > 0 && (
          <>
            <SectionDivider label="Conversation" />
            {displaySubagent.messages.map((msg, i) => (
              <MessageBlock key={i} msg={msg} defaultExpanded={msg.role === "assistant" || i === lastToolIndex} />
            ))}
          </>
        )}

        {/* Result section */}
        {displaySubagent.resultText ? (
          <div ref={resultRef}>
            <SectionDivider label="Result" />
            <div className="inspector-result">
              <ReactMarkdown>{displaySubagent.resultText}</ReactMarkdown>
            </div>
          </div>
        ) : isActive ? (
          <div className="inspector-pending">
            <span className="inspector-pending-dots" />
          </div>
        ) : displaySubagent.messages.length === 0 ? (
          <div className="inspector-empty">No conversation data captured.</div>
        ) : null}
      </div>
    </div>
  );
}
