import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../../store/sessions";
import "./HooksManager.css";

const HOOK_EVENTS = [
  { name: "PreToolUse", desc: "Before tool execution, can block", hasMatcher: true },
  { name: "PostToolUse", desc: "After successful tool execution", hasMatcher: true },
  { name: "PostToolUseFailure", desc: "After tool failure", hasMatcher: true },
  { name: "PermissionRequest", desc: "Before permission prompt", hasMatcher: true },
  { name: "Notification", desc: "On notifications", hasMatcher: true },
  { name: "Stop", desc: "When Claude stops", hasMatcher: false },
  { name: "PreCompact", desc: "Before compaction", hasMatcher: true },
  { name: "PostCompact", desc: "After compaction", hasMatcher: true },
  { name: "UserPromptSubmit", desc: "When user submits", hasMatcher: false },
  { name: "SessionStart", desc: "Session starts", hasMatcher: false },
  { name: "SessionEnd", desc: "Session ends", hasMatcher: false },
] as const;

const HOOK_TYPES = ["command", "prompt", "agent"] as const;

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
  statusMessage?: string;
}

interface MatcherGroup {
  matcher: string;
  hooks: HookEntry[];
}

// Flat representation for display
interface FlatHook {
  eventName: string;
  matcherIndex: number;
  hookIndex: number;
  matcher: string;
  hook: HookEntry;
}

interface FormState {
  eventName: string;
  matcher: string;
  type: string;
  command: string;
  timeout: number;
  statusMessage: string;
}

const EMPTY_FORM: FormState = {
  eventName: "PreToolUse",
  matcher: "",
  type: "command",
  command: "",
  timeout: 60,
  statusMessage: "",
};

interface HooksManagerProps {
  onClose: () => void;
}

type Scope = "user" | "project" | "project-local";

export function HooksManager({ onClose }: HooksManagerProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const [scope, setScope] = useState<Scope>("user");
  const [projectDir, setProjectDir] = useState("");
  const [hooksData, setHooksData] = useState<Record<string, Record<string, MatcherGroup[]>>>({});
  const [editing, setEditing] = useState<FlatHook | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Collect unique project dirs from sessions
  const projectDirs = Array.from(
    new Set(
      sessions
        .filter((s) => !s.isMetaAgent && s.config.workingDir)
        .map((s) => s.config.workingDir)
    )
  );

  // Set initial project dir
  useEffect(() => {
    if (!projectDir && projectDirs.length > 0) {
      setProjectDir(projectDirs[0]);
    }
  }, [projectDir, projectDirs]);

  // Load hooks from backend
  const loadHooks = useCallback(async () => {
    try {
      const dirs = projectDir ? [projectDir] : [];
      const result = await invoke<Record<string, unknown>>("discover_hooks", { workingDirs: dirs });
      // Parse the result into our expected structure
      const parsed: Record<string, Record<string, MatcherGroup[]>> = {};
      for (const [key, val] of Object.entries(result)) {
        if (typeof val === "object" && val !== null) {
          parsed[key] = val as Record<string, MatcherGroup[]>;
        }
      }
      setHooksData(parsed);
    } catch {
      setHooksData({});
    }
  }, [projectDir]);

  useEffect(() => {
    loadHooks();
  }, [loadHooks]);

  // Get hooks for the current scope
  const scopeKey = scope === "user" ? "user" : `project:${projectDir}`;
  const currentHooks: Record<string, MatcherGroup[]> = hooksData[scopeKey] ?? {};

  // Flatten for display
  const flatHooks: FlatHook[] = [];
  for (const [eventName, matcherGroups] of Object.entries(currentHooks)) {
    if (!Array.isArray(matcherGroups)) continue;
    matcherGroups.forEach((mg, mi) => {
      if (!Array.isArray(mg.hooks)) return;
      mg.hooks.forEach((hook, hi) => {
        flatHooks.push({
          eventName,
          matcherIndex: mi,
          hookIndex: hi,
          matcher: mg.matcher || "",
          hook,
        });
      });
    });
  }

  // Save hooks to file
  const saveHooks = useCallback(async (updatedHooks: Record<string, MatcherGroup[]>) => {
    try {
      const workingDir = scope === "user" ? "" : projectDir;
      await invoke("save_hooks", {
        scope,
        workingDir,
        hooksJson: JSON.stringify(updatedHooks),
      });
      setStatusMsg({ text: "Hooks saved", type: "success" });
      setTimeout(() => setStatusMsg(null), 2000);
      await loadHooks();
    } catch (err) {
      setStatusMsg({ text: `Save failed: ${err}`, type: "error" });
    }
  }, [scope, projectDir, loadHooks]);

  // Build updated hooks from current state + form
  const handleSave = useCallback(() => {
    if (!form.command.trim()) return;

    const newHook: HookEntry = {
      type: form.type,
      command: form.command.trim(),
    };
    if (form.timeout !== 60) newHook.timeout = form.timeout;
    if (form.statusMessage.trim()) newHook.statusMessage = form.statusMessage.trim();

    // Clone current hooks
    const updated: Record<string, MatcherGroup[]> = JSON.parse(JSON.stringify(currentHooks));

    if (editing) {
      // Update existing hook
      const groups = updated[editing.eventName];
      if (groups && groups[editing.matcherIndex]?.hooks[editing.hookIndex]) {
        // If event name or matcher changed, remove from old location and add to new
        if (editing.eventName !== form.eventName || groups[editing.matcherIndex].matcher !== form.matcher) {
          groups[editing.matcherIndex].hooks.splice(editing.hookIndex, 1);
          // Clean up empty matcher groups
          if (groups[editing.matcherIndex].hooks.length === 0) {
            groups.splice(editing.matcherIndex, 1);
          }
          if (groups.length === 0) {
            delete updated[editing.eventName];
          }
          // Add to new location
          if (!updated[form.eventName]) updated[form.eventName] = [];
          const existingGroup = updated[form.eventName].find((g) => g.matcher === form.matcher);
          if (existingGroup) {
            existingGroup.hooks.push(newHook);
          } else {
            updated[form.eventName].push({ matcher: form.matcher, hooks: [newHook] });
          }
        } else {
          groups[editing.matcherIndex].hooks[editing.hookIndex] = newHook;
        }
      }
    } else {
      // Add new hook
      if (!updated[form.eventName]) updated[form.eventName] = [];
      const existingGroup = updated[form.eventName].find((g) => g.matcher === form.matcher);
      if (existingGroup) {
        existingGroup.hooks.push(newHook);
      } else {
        updated[form.eventName].push({ matcher: form.matcher, hooks: [newHook] });
      }
    }

    saveHooks(updated);
    setShowForm(false);
    setEditing(null);
    setForm({ ...EMPTY_FORM });
  }, [form, editing, currentHooks, saveHooks]);

  const handleDelete = useCallback((flat: FlatHook) => {
    const updated: Record<string, MatcherGroup[]> = JSON.parse(JSON.stringify(currentHooks));
    const groups = updated[flat.eventName];
    if (!groups) return;
    const group = groups[flat.matcherIndex];
    if (!group) return;
    group.hooks.splice(flat.hookIndex, 1);
    if (group.hooks.length === 0) {
      groups.splice(flat.matcherIndex, 1);
    }
    if (groups.length === 0) {
      delete updated[flat.eventName];
    }
    saveHooks(updated);
  }, [currentHooks, saveHooks]);

  const handleEdit = useCallback((flat: FlatHook) => {
    setEditing(flat);
    setForm({
      eventName: flat.eventName,
      matcher: flat.matcher,
      type: flat.hook.type || "command",
      command: flat.hook.command || "",
      timeout: flat.hook.timeout ?? 60,
      statusMessage: flat.hook.statusMessage ?? "",
    });
    setShowForm(true);
  }, []);

  const handleAdd = useCallback(() => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }, []);

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setEditing(null);
    setForm({ ...EMPTY_FORM });
  }, []);

  const eventHasMatcher = HOOK_EVENTS.find((e) => e.name === form.eventName)?.hasMatcher ?? false;

  return (
    <div className="hooks-overlay" onClick={onClose}>
      <div className="hooks-manager" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="hooks-header">
          <span className="hooks-title">Hooks Manager</span>
          <button className="hooks-close" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        {/* Scope + Project Controls */}
        <div className="hooks-controls">
          <select
            className="hooks-select"
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
          >
            <option value="user">User (~/.claude)</option>
            <option value="project">Project (.claude)</option>
            <option value="project-local">Project Local (.claude/local)</option>
          </select>
          {scope !== "user" && (
            <select
              className="hooks-select hooks-project-select"
              value={projectDir}
              onChange={(e) => setProjectDir(e.target.value)}
            >
              {projectDirs.length === 0 && <option value="">No active projects</option>}
              {projectDirs.map((dir) => (
                <option key={dir} value={dir}>
                  {dir}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Hook List */}
        <div className="hooks-list">
          {flatHooks.length === 0 ? (
            <div className="hooks-empty">No hooks configured for this scope</div>
          ) : (
            flatHooks.map((flat, idx) => (
              <div key={`${flat.eventName}-${flat.matcherIndex}-${flat.hookIndex}-${idx}`} className="hook-card">
                <div className="hook-card-header">
                  <span className="hook-event-name">{flat.eventName}</span>
                  <div className="hook-card-actions">
                    <span className="hook-type-badge">{flat.hook.type || "command"}</span>
                    <button
                      className="hook-card-btn"
                      onClick={() => handleEdit(flat)}
                    >
                      Edit
                    </button>
                    <button
                      className="hook-card-btn hook-card-btn-delete"
                      onClick={() => handleDelete(flat)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {flat.matcher && (
                  <div className="hook-detail">
                    <span className="hook-detail-label">Matcher:</span>
                    <span className="hook-detail-value">{flat.matcher}</span>
                  </div>
                )}
                <div className="hook-detail">
                  <span className="hook-detail-label">Command:</span>
                  <span className="hook-detail-value">{flat.hook.command}</span>
                </div>
                {flat.hook.statusMessage && (
                  <div className="hook-detail">
                    <span className="hook-detail-label">Status:</span>
                    <span className="hook-detail-value">{flat.hook.statusMessage}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Add Hook Button */}
        {!showForm && (
          <button className="hooks-add-btn" onClick={handleAdd}>
            + Add Hook
          </button>
        )}

        {/* Add / Edit Form */}
        {showForm && (
          <div className="hooks-form">
            <div className="hooks-form-title">
              {editing ? "Edit Hook" : "Add Hook"}
            </div>

            <div className="hooks-form-row">
              <span className="hooks-form-label">Event</span>
              <select
                className="hooks-form-select"
                value={form.eventName}
                onChange={(e) => setForm((f) => ({ ...f, eventName: e.target.value }))}
              >
                {HOOK_EVENTS.map((ev) => (
                  <option key={ev.name} value={ev.name}>
                    {ev.name} — {ev.desc}
                  </option>
                ))}
              </select>
            </div>

            {eventHasMatcher && (
              <div className="hooks-form-row">
                <span className="hooks-form-label">Matcher</span>
                <input
                  className="hooks-form-input"
                  value={form.matcher}
                  onChange={(e) => setForm((f) => ({ ...f, matcher: e.target.value }))}
                  placeholder="Bash|Write|Edit (tool names, pipe-separated)"
                />
              </div>
            )}

            <div className="hooks-form-row">
              <span className="hooks-form-label">Type</span>
              <select
                className="hooks-form-select"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                {HOOK_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="hooks-form-row">
              <span className="hooks-form-label">Command</span>
              <input
                className="hooks-form-input"
                value={form.command}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                placeholder="npm test"
              />
            </div>

            <div className="hooks-form-row">
              <span className="hooks-form-label">Timeout</span>
              <input
                className="hooks-form-input"
                type="number"
                min={1}
                max={3600}
                value={form.timeout}
                onChange={(e) => setForm((f) => ({ ...f, timeout: parseInt(e.target.value) || 60 }))}
                style={{ maxWidth: 80 }}
              />
              <span className="hooks-form-hint">seconds</span>
            </div>

            <div className="hooks-form-row">
              <span className="hooks-form-label">Status msg</span>
              <input
                className="hooks-form-input"
                value={form.statusMessage}
                onChange={(e) => setForm((f) => ({ ...f, statusMessage: e.target.value }))}
                placeholder="Running... (optional)"
              />
            </div>

            <div className="hooks-form-actions">
              <button className="hooks-form-cancel" onClick={handleCancel}>
                Cancel
              </button>
              <button
                className="hooks-form-save"
                onClick={handleSave}
                disabled={!form.command.trim()}
              >
                {editing ? "Update" : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Status message */}
        {statusMsg && (
          <div className={`hooks-status ${statusMsg.type === "success" ? "hooks-status-success" : "hooks-status-error"}`}>
            {statusMsg.text}
          </div>
        )}
      </div>
    </div>
  );
}
