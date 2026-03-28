import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../store/settings";
import { dlog } from "../../lib/debugLog";
import type { AgentFile } from "../../lib/settingsSchema";
import type { PaneComponentProps } from "./ThreePaneEditor";

export function SkillsEditor({ scope, projectDir, onStatus }: PaneComponentProps) {
  const [skills, setSkills] = useState<AgentFile[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [newSkillName, setNewSkillName] = useState("");

  const commandUsage = useSettingsStore((s) => s.commandUsage);

  const workingDir = scope === "user" ? "" : projectDir;

  const loadSkills = useCallback(async () => {
    try {
      const result = await invoke<AgentFile[]>("list_skills", { scope, workingDir });
      setSkills(result);
    } catch (err) {
      dlog("config", null, `list_skills failed: ${err}`, "ERR");
      setSkills([]);
    }
    setLoading(false);
  }, [scope, workingDir]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  // Auto-select first skill or new-skill mode
  useEffect(() => {
    if (!loading && selectedSkill === null) {
      setSelectedSkill(skills.length > 0 ? skills[0].name : "__new__");
    }
  }, [loading, skills, selectedSkill]);

  // Load selected skill content (with cancellation to prevent stale writes on rapid selection)
  useEffect(() => {
    if (!selectedSkill || selectedSkill === "__new__") {
      setContent("");
      setSavedContent("");
      return;
    }
    const skill = skills.find((s) => s.name === selectedSkill);
    if (!skill) return;

    let cancelled = false;
    invoke<string>("read_config_file", {
      scope,
      workingDir,
      fileType: `skill:${skill.name}`,
    }).then((result) => {
      if (!cancelled) { setContent(result); setSavedContent(result); }
    }).catch((err) => {
      dlog("config", null, `read skill failed: ${err}`, "ERR");
      if (!cancelled) { setContent(""); setSavedContent(""); }
    });
    return () => { cancelled = true; };
  }, [selectedSkill, skills, scope, workingDir]);

  const handleSave = useCallback(async () => {
    if (!selectedSkill || selectedSkill === "__new__") return;
    try {
      await invoke("write_config_file", {
        scope,
        workingDir,
        fileType: `skill:${selectedSkill}`,
        content,
      });
      setSavedContent(content);
      onStatus({ text: "Skill saved", type: "success" });
      setTimeout(() => onStatus(null), 2000);
      useSettingsStore.getState().triggerCommandRefresh();
    } catch (err) {
      dlog("config", null, `save skill failed: ${err}`, "ERR");
      onStatus({ text: `Save failed: ${err}`, type: "error" });
    }
  }, [selectedSkill, scope, workingDir, content, onStatus]);

  const handleCreate = useCallback(async () => {
    const name = newSkillName.trim().replace(/\.md$/, "").replace(/[^a-zA-Z0-9_-]/g, "-");
    if (!name) return;
    if (skills.some((s) => s.name === name)) {
      onStatus({ text: `Skill "${name}" already exists`, type: "error" });
      return;
    }
    try {
      await invoke("write_config_file", {
        scope,
        workingDir,
        fileType: `skill:${name}`,
        content,
      });
      setNewSkillName("");
      await loadSkills();
      setSelectedSkill(name);
      setSavedContent(content);
      onStatus({ text: `Skill "${name}" created`, type: "success" });
      setTimeout(() => onStatus(null), 2000);
      useSettingsStore.getState().triggerCommandRefresh();
    } catch (err) {
      dlog("config", null, `create skill failed: ${err}`, "ERR");
      onStatus({ text: `Create failed: ${err}`, type: "error" });
    }
  }, [newSkillName, scope, workingDir, content, skills, loadSkills, onStatus]);

  const handleDelete = useCallback(async () => {
    if (!selectedSkill || selectedSkill === "__new__") return;
    try {
      await invoke("write_config_file", {
        scope,
        workingDir,
        fileType: `skill-delete:${selectedSkill}`,
        content: "",
      });
      setSelectedSkill(null);
      await loadSkills();
      onStatus({ text: `Skill "${selectedSkill}" deleted`, type: "success" });
      setTimeout(() => onStatus(null), 2000);
      useSettingsStore.getState().triggerCommandRefresh();
    } catch (err) {
      dlog("config", null, `delete skill failed: ${err}`, "ERR");
      onStatus({ text: `Delete failed: ${err}`, type: "error" });
    }
  }, [selectedSkill, scope, workingDir, loadSkills, onStatus]);

  const isNew = selectedSkill === "__new__";
  const dirty = isNew ? newSkillName.trim() !== "" && content !== "" : content !== savedContent;

  if (loading) return <div className="config-md-hint">Loading...</div>;

  return (
    <div className="config-md-editor">
      <div className="config-md-editor-list">
        {skills.map((skill) => {
          const usage = commandUsage[`/${skill.name}`] || 0;
          return (
            <button
              key={skill.name}
              className={`config-md-editor-item${selectedSkill === skill.name ? " active" : ""}`}
              onClick={() => setSelectedSkill(skill.name)}
            >
              /{skill.name}
              {usage > 0 && <span className="config-md-editor-usage">{usage}</span>}
            </button>
          );
        })}
        <button
          className={`config-md-editor-item config-md-editor-new${isNew ? " active" : ""}`}
          onClick={() => { setSelectedSkill("__new__"); setNewSkillName(""); setContent(""); }}
        >
          + new skill
        </button>
      </div>

      <div className="config-md-editor-body">
        <div className="config-md-editor-header">
          {isNew ? (
            <input
              className="config-input config-md-editor-name-input"
              value={newSkillName}
              onChange={(e) => setNewSkillName(e.target.value)}
              placeholder="skill-name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && dirty) handleCreate();
                if (e.key === "Escape") e.stopPropagation();
              }}
              autoFocus
            />
          ) : (
            <span className="config-md-editor-name">/{selectedSkill}.md</span>
          )}
          <div className="config-md-editor-actions">
            <button
              className="config-save-btn"
              onClick={isNew ? handleCreate : handleSave}
              disabled={!dirty}
            >
              {isNew ? "Create" : dirty ? "Save" : "Saved"}
            </button>
            {!isNew && (
              <button className="config-md-editor-delete" onClick={handleDelete}>Delete</button>
            )}
          </div>
        </div>
        <textarea
          className="pane-textarea pane-textarea-md"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={isNew ? "Skill prompt content... (use $ARGUMENTS for user input)" : ""}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === "s") {
              e.preventDefault();
              if (dirty) isNew ? handleCreate() : handleSave();
            }
            if (e.key === "Tab") {
              e.preventDefault();
              const ta = e.currentTarget;
              const start = ta.selectionStart;
              const end = ta.selectionEnd;
              setContent((prev) => prev.slice(0, start) + "  " + prev.slice(end));
              setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2; }, 0);
            }
          }}
        />
      </div>
    </div>
  );
}
