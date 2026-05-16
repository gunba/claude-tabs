import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRuntimeStore } from "../../store/runtime";
import { useSettingsStore } from "../../store/settings";
import type { TerminalRenderer } from "../../store/settings/types";
import type { CliKind } from "../../types/session";
import type { StatusMessage } from "../../lib/settingsSchema";
import "./RecordingPane.css";
import "./AppSettingsPane.css";

interface AppSettingsPaneProps {
  onStatus: (msg: StatusMessage | null) => void;
}

const RENDERER_OPTIONS: Array<{ value: TerminalRenderer; label: string; hint: string }> = [
  { value: "webgl", label: "WebGL (GPU)", hint: "Default. Smoother for fast output." },
  { value: "canvas", label: "Canvas (CPU)", hint: "Lower GPU load. Use if embeddings or other GPU work conflict with the terminal." },
];

const CLI_LABELS: Record<CliKind, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
};

export function AppSettingsPane({ onStatus }: AppSettingsPaneProps) {
  const observabilityInfo = useRuntimeStore((s) => s.observabilityInfo);
  const setObservabilityEnabled = useRuntimeStore((s) => s.setObservabilityEnabled);
  const setDevtoolsEnabled = useRuntimeStore((s) => s.setDevtoolsEnabled);
  const openMainDevtools = useRuntimeStore((s) => s.openMainDevtools);
  const globalLogPath = observabilityInfo.globalLogPath;
  const [updatingObservability, setUpdatingObservability] = useState(false);
  const [updatingDevtools, setUpdatingDevtools] = useState(false);

  const codexAutoRenameEnabled = useSettingsStore((s) => s.codexAutoRenameLLMEnabled);
  const codexAutoRenameModel = useSettingsStore((s) => s.codexAutoRenameLLMModel);
  const setCodexAutoRenameEnabled = useSettingsStore((s) => s.setCodexAutoRenameLLMEnabled);
  const setCodexAutoRenameModel = useSettingsStore((s) => s.setCodexAutoRenameLLMModel);

  const rendererByCli = useSettingsStore((s) => s.rendererByCli);
  const setRendererForCli = useSettingsStore((s) => s.setRendererForCli);

  const toggleObservability = useCallback(async () => {
    setUpdatingObservability(true);
    try {
      await setObservabilityEnabled(!observabilityInfo.observabilityEnabled);
      onStatus({
        type: "success",
        text: !observabilityInfo.observabilityEnabled
          ? "Observability enabled"
          : "Observability disabled",
      });
    } catch {
      onStatus({ type: "error", text: "Could not update observability" });
    } finally {
      setUpdatingObservability(false);
    }
  }, [observabilityInfo.observabilityEnabled, onStatus, setObservabilityEnabled]);

  const toggleDevtools = useCallback(async () => {
    setUpdatingDevtools(true);
    try {
      await setDevtoolsEnabled(!observabilityInfo.devtoolsEnabled);
      onStatus({
        type: "success",
        text: !observabilityInfo.devtoolsEnabled
          ? "DevTools enabled"
          : "DevTools disabled",
      });
    } catch {
      onStatus({ type: "error", text: "Could not update DevTools" });
    } finally {
      setUpdatingDevtools(false);
    }
  }, [observabilityInfo.devtoolsEnabled, onStatus, setDevtoolsEnabled]);

  const openAppLog = useCallback(async () => {
    try {
      await invoke("open_observability_log", { sessionId: null });
    } catch {
      onStatus({ type: "error", text: "Could not open app observability log" });
    }
  }, [onStatus]);

  const openDevtools = useCallback(async () => {
    try {
      await openMainDevtools();
    } catch (e) {
      onStatus({ type: "error", text: typeof e === "string" ? e : "Could not open DevTools" });
    }
  }, [openMainDevtools, onStatus]);

  return (
    <div className="recording-pane">
      {/* Terminal renderer (per CLI) */}
      <div className="recording-section">
        <div className="recording-section-title">Terminal Renderer</div>
        <span className="recording-hint">
          WebGL uses the GPU and is smoother for high-volume output, but it can compete with
          other GPU work (for example, CPU embeddings that touch the GPU). Switch to Canvas to
          fall back to xterm.js's DOM renderer. Change takes effect on the next session respawn.
        </span>
        <div className="app-renderer-grid">
          {(["claude", "codex"] as CliKind[]).map((cli) => (
            <div key={cli} className="app-renderer-row">
              <div className="app-renderer-label">{CLI_LABELS[cli]}</div>
              <div className="app-renderer-options" role="radiogroup" aria-label={`${CLI_LABELS[cli]} terminal renderer`}>
                {RENDERER_OPTIONS.map((opt) => (
                  <label key={opt.value} className="app-renderer-option" title={opt.hint}>
                    <input
                      type="radio"
                      name={`renderer-${cli}`}
                      value={opt.value}
                      checked={rendererByCli[cli] === opt.value}
                      onChange={() => setRendererForCli(cli, opt.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Codex tab auto-rename via small model */}
      <div className="recording-section">
        <label className="recording-master-toggle">
          <input
            type="checkbox"
            checked={codexAutoRenameEnabled}
            onChange={(e) => setCodexAutoRenameEnabled(e.target.checked)}
          />
          <span className="recording-section-title">Auto-rename Codex tabs via small model</span>
          <span className="recording-hint">
            On the first user message, generate a short tab title via <code>codex exec</code>.
            Reuses your existing Codex auth.
          </span>
        </label>
        <div className="app-renderer-row">
          <div className="app-renderer-label">Model</div>
          <input
            type="text"
            className="codex-app-prefs-input"
            value={codexAutoRenameModel}
            onChange={(e) => setCodexAutoRenameModel(e.target.value)}
            disabled={!codexAutoRenameEnabled}
            placeholder="gpt-5-mini"
            spellCheck={false}
          />
        </div>
      </div>

      {/* [DP-17] App Observability + DevTools master toggles persist to ui-config.json (set_observability_enabled / set_devtools_enabled) and survive across sessions. */}
      <div className="recording-section">
        <label className="recording-master-toggle">
          <input
            type="checkbox"
            checked={observabilityInfo.observabilityEnabled}
            onChange={toggleObservability}
            disabled={updatingObservability}
          />
          <span className="recording-section-title">App Observability</span>
          <span className="recording-hint">
            Persist backend and frontend diagnostic events
          </span>
        </label>
        <div className="recording-data-row">
          <button className="recording-btn" onClick={openAppLog}>
            Open App Log
          </button>
          {globalLogPath && (
            <span className="recording-hint">{globalLogPath}</span>
          )}
        </div>
        <span className="recording-hint">
          Level {observabilityInfo.minLevel ?? "DEBUG"} |{" "}
          {Math.round((observabilityInfo.globalLogSize ?? 0) / 1024)} KiB |{" "}
          {observabilityInfo.globalRotationCount ?? 0} rotated
        </span>
      </div>

      <div className="recording-section">
        <label className="recording-master-toggle">
          <input
            type="checkbox"
            checked={observabilityInfo.devtoolsEnabled}
            onChange={toggleDevtools}
            disabled={updatingDevtools}
          />
          <span className="recording-section-title">DevTools</span>
          <span className="recording-hint">
            Allow opening the WebView inspector for UI debugging
          </span>
        </label>
        <div className="recording-data-row">
          <button
            className="recording-btn"
            onClick={openDevtools}
            disabled={!observabilityInfo.devtoolsEnabled}
          >
            Open DevTools
          </button>
          <span className="recording-hint">
            Or press Ctrl+Shift+I when enabled
          </span>
        </div>
      </div>
    </div>
  );
}
