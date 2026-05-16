---
paths:
  - "src/components/ConfigManager/AppSettingsPane.tsx"
---

# src/components/ConfigManager/AppSettingsPane.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Debug Panel

- [DP-17 L156] RecordingPane has two master toggles: 'App Observability' (persists backend/frontend events via set_observability_enabled, surfaces Open App Log button + log path / size / rotation count) and 'DevTools' (persists via set_devtools_enabled, surfaces an 'Open DevTools' button that calls openMainDevtools and is disabled until devtoolsEnabled is true). Both toggles persist to ui-config.json and survive across sessions. TabContextMenu's per-session observability submenu (Open Session Data / Open Tap Log / Open Observability Log) renders only when observabilityEnabled is true (props the flag through from useRuntimeStore.observabilityInfo). The console-mirror in debugLog.forwardToConsoleRaw forwards LOG-level entries to the browser console only when observabilityEnabled is true; WARN/ERR always forward.

## Config Schema and Providers

- [CM-36 L11] App config tab is CLI-agnostic (shown for both Claude and Codex sessions) and hosts cross-CLI preferences: per-CLI Terminal Renderer choice ('webgl' GPU default, 'canvas' DOM fallback), Auto-rename Codex tabs via small model, App Observability master toggle (set_observability_enabled), and DevTools master toggle (set_devtools_enabled). rendererByCli is a Record<CliKind, TerminalRenderer> in the settings store defaulting to {claude:'webgl', codex:'webgl'}; migration v27 backfills it on existing settings. TerminalPanel reads rendererByCli[session.config.cli] and passes enableWebgl: rendererChoice === 'webgl' to useTerminal; xterm.js loads the WebGL addon only when enabled and falls back to the DOM/canvas renderer otherwise. The previous Codex-skip-WebGL hardcode (TerminalPanel:215) was removed — both CLIs default to WebGL with the toggle as the user-controlled escape hatch. The Observability tab's App Observability + DevTools sections moved to the App tab (they were already app-global per ui-config.json — showing them per-CLI implied per-CLI semantics they never had). RecordingPane's TAP Recording section is gated on cli === 'claude' (Codex has no inspector to hook). Auto-rename Codex tabs is a Code Tabs app preference, not part of Codex's config.toml — it moved out of SettingsTab into the App tab.
