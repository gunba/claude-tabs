import { lazy, Suspense, useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "./store/sessions";
import { useSettingsStore } from "./store/settings";
import { dirToTabName, getResumeId, resolveResumeId, getLaunchWorkingDir, canResumeSession, stripWorktreeFlags } from "./lib/claude";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";

import { SessionLauncher } from "./components/SessionLauncher/SessionLauncher";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { CommandBar } from "./components/CommandBar/CommandBar";
import { CONFIG_MANAGER_CLOSE_REQUEST_EVENT } from "./components/ConfigManager/events";
import { RightPanel } from "./components/RightPanel/RightPanel";

import { useCliWatcher } from "./hooks/useCliWatcher";
import { useNotifications } from "./hooks/useNotifications";
import { useCommandDiscovery } from "./hooks/useCommandDiscovery";
import { useProcessMetrics } from "./hooks/useProcessMetrics";
import { useCtrlKey } from "./hooks/useCtrlKey";
import { useUiConfigStore } from "./lib/uiConfig";
import { useVersionStore } from "./store/version";
import { useWeatherStore } from "./store/weather";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { killAllActivePtys } from "./lib/ptyProcess";
import { killPty, writeToPty } from "./lib/ptyRegistry";
import { focusTerminal } from "./lib/terminalRegistry";
import { dlog, flushDebugLog } from "./lib/debugLog";
import { Header } from "./components/Header/Header";
import { groupSessionsByDir, parseWorktreePath, IS_LINUX } from "./lib/paths";
import type { CliKind, Session, Subagent } from "./types/session";
import { getEffectiveState } from "./lib/claude";
import { settledStateManager, type SettledKind } from "./lib/settledState";
import { useRuntimeStore } from "./store/runtime";
import { isCliVersionIncrease, type ChangelogRequest } from "./lib/changelog";
import { TabBar } from "./components/TabBar/TabBar";
import { SubagentBar } from "./components/SubagentBar/SubagentBar";
import { TabContextMenu, type TabContextMenuRequest } from "./components/TabContextMenu/TabContextMenu";
import { PruneDialog, type PruneRequest } from "./components/PruneDialog/PruneDialog";
import { cycleTabId, jumpTabId } from "./lib/tabCycle";
import "./App.css";

const ChangelogModal = lazy(() => import("./components/ChangelogModal/ChangelogModal").then((m) => ({ default: m.ChangelogModal })));
const CommandPalette = lazy(() => import("./components/CommandPalette/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const ConfigManager = lazy(() => import("./components/ConfigManager/ConfigManager").then((m) => ({ default: m.ConfigManager })));
const ContextViewer = lazy(() => import("./components/ContextViewer/ContextViewer").then((m) => ({ default: m.ContextViewer })));
const ResumePicker = lazy(() => import("./components/ResumePicker/ResumePicker").then((m) => ({ default: m.ResumePicker })));
const SubagentInspector = lazy(() => import("./components/SubagentInspector/SubagentInspector").then((m) => ({ default: m.SubagentInspector })));

// [DF-04] React re-renders from Zustand store: tab state dots, status bar, subagent cards
export default function App() {
  const init = useSessionStore((s) => s.init);
  const loadRuntimeInfo = useRuntimeStore((s) => s.loadRuntimeInfo);
  const devtoolsAvailable = useRuntimeStore((s) => s.observabilityInfo.devtoolsAvailable);
  const debugBuild = useRuntimeStore((s) => s.observabilityInfo.debugBuild);
  const openMainDevtools = useRuntimeStore((s) => s.openMainDevtools);
  const sessions = useSessionStore((s) => s.sessions);
  const initialized = useSessionStore((s) => s.initialized);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const setActiveTab = useSessionStore((s) => s.setActiveTab);
  const closeSession = useSessionStore((s) => s.closeSession);
  const createSession = useSessionStore((s) => s.createSession);
  const persist = useSessionStore((s) => s.persist);
  const reorderTabs = useSessionStore((s) => s.reorderTabs);
  const requestKill = useSessionStore((s) => s.requestKill);
  const inspectorOffSessions = useSessionStore((s) => s.inspectorOffSessions);
  const setInspectorOff = useSessionStore((s) => s.setInspectorOff);
  const showLauncher = useSettingsStore((s) => s.showLauncher);
  const launcherGeneration = useSettingsStore((s) => s.launcherGeneration);
  const setShowLauncher = useSettingsStore((s) => s.setShowLauncher);
  const setLastConfig = useSettingsStore((s) => s.setLastConfig);
  const showConfigManager = useSettingsStore((s) => s.showConfigManager);
  const setShowConfigManager = useSettingsStore((s) => s.setShowConfigManager);
  const [showPalette, setShowPalette] = useState(false);
  const [showResumePicker, setShowResumePicker] = useState(false);
  const [showContextViewer, setShowContextViewer] = useState(false);
  const [changelogRequest, setChangelogRequest] = useState<ChangelogRequest | null>(null);
  const [inspectedSubagent, setInspectedSubagent] = useState<{ sessionId: string; subagentId: string } | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuRequest | null>(null);
  const [settledTabs, setSettledTabs] = useState<Map<string, SettledKind>>(new Map());
  const ctrlHeld = useCtrlKey();
  const initRef = useRef(false);
  const handledCliVersionRef = useRef<Partial<Record<CliKind, string>>>({});
  const [pruneConfirm, setPruneConfirm] = useState<PruneRequest | null>(null);
  useCliWatcher();
  useNotifications();
  useCommandDiscovery();
  useProcessMetrics();

  // Feed settled-state manager from effective state changes.
  // Replaces per-consumer ad-hoc debounce with a unified hysteresis system.
  const subagentMap = useSessionStore((s) => s.subagents);
  useEffect(() => {
    const subagents = useSessionStore.getState().subagents;
    for (const s of sessions) {
      const effState = getEffectiveState(s.state, subagents.get(s.id) || []);
      settledStateManager.update(s.id, effState);
    }
    // Clean up removed sessions
    const sessionIds = new Set(sessions.map((s) => s.id));
    for (const id of settledStateManager._getTrackedSessions()) {
      if (!sessionIds.has(id)) settledStateManager.removeSession(id);
    }
  }, [sessions, subagentMap]);

  // Subscribe to settled-state changes for tab styling
  useEffect(() => {
    return settledStateManager.subscribe(
      (sid, kind) => setSettledTabs((prev) => new Map(prev).set(sid, kind)),
      (sid) => setSettledTabs((prev) => { const n = new Map(prev); n.delete(sid); return n; }),
    );
  }, []);

  // Initialize once
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void (async () => {
      await loadRuntimeInfo();
      await init();
      useUiConfigStore.getState().loadConfig();
      useSettingsStore.getState().loadPastSessions();
      useSettingsStore.getState().pruneRecentDirs();
      invoke("migrate_legacy_data").catch(() => {});
      // [HM-11] Startup intentionally does not install or mutate Claude hook
      // settings; hook changes are user-managed via the Hooks UI only.
      invoke("cleanup_session_data", { maxAgeHours: 72 }).catch(() => {});
      // Version + update checks: fire after init (non-blocking, failures ignored)
      useVersionStore.getState().loadBuildInfo();
      useVersionStore.getState().checkForAppUpdate();
      useVersionStore.getState().checkLatestCliVersion();
      // [WX-01] Hydrate ambient-viz weather from cache + subscribe to updates.
      void useWeatherStore.getState().init();
    })();
  }, [init, loadRuntimeInfo]);

  // Dynamic window title with version info
  const appVersion = useVersionStore((s) => s.appVersion);
  const cliVersions = useSettingsStore((s) => s.cliVersions);
  const lastOpenedCliVersions = useSettingsStore((s) => s.lastOpenedCliVersions);
  const setLastOpenedCliVersion = useSettingsStore((s) => s.setLastOpenedCliVersion);
  useEffect(() => {
    const parts = ["Code Tabs"];
    if (appVersion) parts[0] += ` v${appVersion}`;
    parts.push(`Claude ${cliVersions.claude ?? "not installed"}`);
    parts.push(`Codex ${cliVersions.codex ?? "not installed"}`);
    getCurrentWindow().setTitle(parts.join(" · ")).catch(() => {});
  }, [appVersion, cliVersions]);

  useEffect(() => {
    const ranges: ChangelogRequest["ranges"] = {};
    for (const cli of ["claude", "codex"] as const) {
      const current = cliVersions[cli];
      if (!current) continue;
      if (handledCliVersionRef.current[cli] === current) continue;
      handledCliVersionRef.current[cli] = current;

      const previous = lastOpenedCliVersions[cli];
      if (previous && isCliVersionIncrease(current, previous)) {
        ranges[cli] = { fromVersion: previous, toVersion: current };
      }
      if (previous !== current) {
        setLastOpenedCliVersion(cli, current);
      }
    }

    const changedCli = (["claude", "codex"] as const).find((cli) => ranges[cli]);
    if (changedCli && !changelogRequest) {
      setChangelogRequest({
        kind: "startup",
        initialCli: changedCli,
        ranges,
      });
    }
  }, [changelogRequest, cliVersions, lastOpenedCliVersions, setLastOpenedCliVersion]);

  // [PL-01] Linux custom titlebar: tauri.conf.json sets decorations:false globally so non-KDE
  // Wayland compositors honor it at window creation. Non-Linux re-enables native decorations
  // at runtime. KDE+Wayland is a known upstream Tauri bug (issues #6162/#6562 — KWin ignores
  // decorations:false from wry's GTK-Wayland window), so on that combo we restore native
  // decorations and skip our custom Header to avoid a duplicated titlebar.
  const [useNativeChrome, setUseNativeChrome] = useState(false);
  useEffect(() => {
    (async () => {
      const native = IS_LINUX ? await invoke<boolean>("linux_use_native_chrome").catch(() => false) : true;
      setUseNativeChrome(native);
      if (native) {
        await getCurrentWindow().setDecorations(true).catch(() => {});
      }
    })();
  }, []);

  // [SL-02] Quick launch: Ctrl+Click "+" or Ctrl+Shift+T, uses saved defaults or last config
  const quickLaunch = useCallback(async () => {
    const { savedDefaults, lastConfig } = useSettingsStore.getState();
    const defaults = (savedDefaults && savedDefaults.workingDir.trim()) ? savedDefaults : lastConfig;
    if (!defaults || !defaults.workingDir.trim()) {
      setShowLauncher(true);
      return;
    }
    // [RS-04] One-shot flags cleared: resumeSession, continueSession never persist in lastConfig
    const cleanConfig = { ...defaults, resumeSession: null, continueSession: false, sessionId: null, runMode: false };
    const { claudePath, codexPath } = useSessionStore.getState();
    const installedCli = [
      ...(claudePath ? ["claude" as const] : []),
      ...(codexPath ? ["codex" as const] : []),
    ];
    if (installedCli.length === 0) {
      setShowLauncher(true);
      return;
    }
    if (!installedCli.includes(cleanConfig.cli)) {
      cleanConfig.cli = installedCli[0];
    }
    const name = dirToTabName(cleanConfig.workingDir);
    useSettingsStore.getState().addRecentDir(cleanConfig.workingDir);
    useSettingsStore.getState().setLastConfig(cleanConfig);
    try {
      await createSession(name, cleanConfig);
    } catch {
      // Fall back to modal on failure
      setShowLauncher(true);
    }
  }, [createSession, setShowLauncher]);

  // [PS-03] Debounced auto-persist every 2s on session array changes
  useEffect(() => {
    if (sessions.length > 0) {
      const timer = setTimeout(() => persist(), 2000);
      return () => clearTimeout(timer);
    }
  }, [sessions, persist]);

  // [PS-02] [PS-04] beforeunload: kill all active PTY trees + flush persist
  useEffect(() => {
    const handler = () => {
      killAllActivePtys();
      void flushDebugLog();
      persist();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [persist]);

  const relaunchDeadSession = useCallback(async (session: Session) => {
    // [RS-09] Auto-resolve: if the dead tab's stored sessionId lost touch
    // with the actual JSONL on disk (e.g. TAP missed the rename, or the
    // fallback id is the Code Tabs app UUID which is never a real CLI
    // session id), pick the right JSONL by cwd + closest lastActive.
    // Falls through to getResumeId() when pastSessions is empty / not
    // yet loaded so we don't regress the common path.
    const pastSessions = useSettingsStore.getState().pastSessions;
    const resolvedId = resolveResumeId(session, pastSessions);
    const resumeId = resolvedId ?? getResumeId(session);

    const resumeConfig = {
      ...session.config,
      workingDir: getLaunchWorkingDir(session),
      launchWorkingDir: getLaunchWorkingDir(session),
      resumeSession: resumeId,
      continueSession: false,
      extraFlags: stripWorktreeFlags(session.config.extraFlags),
    };
    const insertAtIndex = sessions.findIndex((s) => s.id === session.id);
    const name = session.name || dirToTabName(getLaunchWorkingDir(session));

    try {
      await createSession(
        name,
        resumeConfig,
        insertAtIndex >= 0 ? { insertAtIndex } : undefined,
      );
      await closeSession(session.id);
    } catch (err) {
      dlog("session", session.id, `dead tab relaunch failed: ${err}`, "ERR");
      setActiveTab(session.id);
    }
  }, [closeSession, createSession, sessions, setActiveTab]);

  // Activate tab — dead tabs relaunch explicitly, live tabs are focused.
  const handleTabActivate = useCallback(
    (id: string) => {
      setInspectedSubagent(null);
      settledStateManager.clearSettled(id);
      if (activeTabId && activeTabId !== id && settledTabs.get(activeTabId) === "idle") {
        settledStateManager.clearSettled(activeTabId);
      }
      const session = sessions.find((s) => s.id === id);
      if (!session) return;

      if (session.state === "dead" && canResumeSession(session)) {
        void relaunchDeadSession(session);
        return;
      }

      if (id !== activeTabId) {
        setActiveTab(id);
      }
    },
    [activeTabId, relaunchDeadSession, sessions, setActiveTab, settledTabs]
  );

  // Close session, prompting for worktree prune on manual single-tab close
  const handleCloseSession = useCallback((id: string) => {
    const session = sessions.find((s) => s.id === id);
    if (session) {
      const wt = parseWorktreePath(session.config.workingDir);
      if (wt) {
        setPruneConfirm({
          sessionId: id, worktreePath: session.config.workingDir,
          worktreeName: wt.worktreeName, projectRoot: wt.projectRoot,
        });
        return;
      }
    }
    closeSession(id);
  }, [sessions, closeSession]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "t") {
        e.preventDefault();
        if (e.shiftKey) {
          // [SL-02] Ctrl+Shift+T: quick launch without modal
          quickLaunch();
        } else {
          // [KB-01] [SL-01] Ctrl+T: open new session (clears resume/continue)
          const lc = useSettingsStore.getState().lastConfig;
          if (lc.resumeSession || lc.continueSession) {
            setLastConfig({ ...lc, resumeSession: null, continueSession: false });
          }
          setShowLauncher(true);
        }
      }

      // [KB-02] Ctrl+W: close active tab
      if (e.ctrlKey && e.key === "w") {
        e.preventDefault();
        if (activeTabId) handleCloseSession(activeTabId);
      }

      // [KB-06] Ctrl+K: command palette
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
      }

      // [KB-03] Ctrl+Shift+R: resume picker
      // [DS-05] Resume picker opens regardless of current session state.
      if (e.ctrlKey && e.shiftKey && e.key === "R") {
        e.preventDefault();
        setShowResumePicker(true);
      }

      // [KB-11] Ctrl+Shift+F: open RightPanel search tab (cross-session terminal search)
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        useSettingsStore.getState().setRightPanelTab("search");
      }

      // [KB-07] Ctrl+,: config manager
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        if (showConfigManager) {
          window.dispatchEvent(new Event(CONFIG_MANAGER_CLOSE_REQUEST_EVENT));
        } else {
          setShowConfigManager("settings");
        }
      }

      if (devtoolsAvailable && e.ctrlKey && e.shiftKey && e.key === "I") {
        e.preventDefault();
        openMainDevtools().catch(() => {});
      }

      // [KB-09] Escape dismissal chain: contextMenu -> palette -> changelog -> contextViewer -> config -> resume -> launcher -> inspector
      if (e.key === "Escape") {
        if (tabContextMenu) { setTabContextMenu(null); return; }
        if (showPalette) return;
        if (changelogRequest) { setChangelogRequest(null); return; }
        if (showContextViewer) { setShowContextViewer(false); return; }
        if (showConfigManager) { window.dispatchEvent(new Event(CONFIG_MANAGER_CLOSE_REQUEST_EVENT)); return; }
        if (showResumePicker) { setShowResumePicker(false); return; }
        if (showLauncher) { setShowLauncher(false); return; }
        if (inspectedSubagent) { e.preventDefault(); setInspectedSubagent(null); return; }
        const el = document.activeElement as HTMLElement | null;
        if (el && !el.closest('.xterm')) {
          e.preventDefault();
          el.blur();
          if (activeTabId) {
            requestAnimationFrame(() => focusTerminal(activeTabId));
          }
        } else if (activeTabId) {
          writeToPty(activeTabId, '\x1b');
        }
      }

      // [KB-04] Ctrl+Tab/Ctrl+Shift+Tab: cycle live tabs only
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const nextId = cycleTabId(sessions, activeTabId, e.shiftKey ? "previous" : "next");
        if (nextId) setActiveTab(nextId);
      }

      // [KB-05] Alt+1-9: jump to tab N
      if (e.altKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const targetId = jumpTabId(sessions, parseInt(e.key, 10));
        if (targetId) setActiveTab(targetId);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabId, sessions, setActiveTab, closeSession, handleCloseSession, setShowLauncher, showPalette, showLauncher, showResumePicker, showConfigManager, setShowConfigManager, changelogRequest, showContextViewer, inspectedSubagent, tabContextMenu, quickLaunch, devtoolsAvailable, openMainDevtools]);

  const regularSessions = sessions.filter((s) => !s.isMetaAgent);
  const groups = groupSessionsByDir(regularSessions);
  const activeSubagent: Subagent | null = inspectedSubagent
    ? (subagentMap.get(inspectedSubagent.sessionId) || []).find(
        (s) => s.id === inspectedSubagent.subagentId
      ) ?? null
    : null;

  // Active session's subagents + skill invocations — unified bar items
  const activeSession = sessions.find((s) => s.id === activeTabId);
  // [PO-01] Provider-scoped accents: app-provider-{cli} root class swaps --accent palette to the active session's CLI; per-tab .tab-cli-{cli} keeps inactive tabs colored by their own CLI.
  const activeProvider = activeSession?.config.cli ?? "claude";
  const allSubs = activeTabId ? (subagentMap.get(activeTabId) || []) : [];

  const handleRelaunchWithOptions = useCallback((session: Session) => {
    setLastConfig({
      ...session.config,
      workingDir: getLaunchWorkingDir(session),
      launchWorkingDir: getLaunchWorkingDir(session),
      resumeSession: getResumeId(session),
      continueSession: false,
    });
    useSettingsStore.getState().setReplaceSessionId(session.id);
    setShowLauncher(true);
  }, [setLastConfig, setShowLauncher]);

  const handleKeepWorktree = useCallback((request: PruneRequest) => {
    closeSession(request.sessionId);
    setPruneConfirm(null);
  }, [closeSession]);

  const handlePruneWorktree = useCallback((request: PruneRequest) => {
    const { sessionId, worktreePath, projectRoot } = request;
    setPruneConfirm(null);
    closeSession(sessionId);
    void (async () => {
      try {
        await killPty(sessionId);
      } catch (err) {
        dlog("session", sessionId, `prune: killPty failed: ${err}`, "ERR");
      }
      try {
        await invoke("prune_worktree", { worktreePath, projectRoot });
      } catch (err) {
        dlog("session", sessionId, `prune: git worktree remove failed: ${err}`, "ERR");
      }
    })();
  }, [closeSession]);

  return (
    <div className={`app app-provider-${activeProvider}${ctrlHeld ? " ctrl-held" : ""}`}>
      {IS_LINUX && !useNativeChrome && <Header />}
      {/* [LO-01] Main window layout: tab bar, subagent bar, terminal area, CommandBar (slash commands + skill pills + history), StatusBar. */}
      <TabBar
        groups={groups}
        regularSessions={regularSessions}
        activeTabId={activeTabId}
        subagentMap={subagentMap}
        settledTabs={settledTabs}
        inspectorOffSessions={inspectorOffSessions}
        ctrlHeld={ctrlHeld}
        onActivate={handleTabActivate}
        onCloseSession={handleCloseSession}
        onRequestKill={requestKill}
        onReorderTabs={reorderTabs}
        onRelaunchWithOptions={handleRelaunchWithOptions}
        onOpenContextMenu={setTabContextMenu}
        onClearSettled={(sessionId) => settledStateManager.clearSettled(sessionId)}
        onOpenResumePicker={() => setShowResumePicker(true)}
        onOpenConfigManager={() => setShowConfigManager("settings")}
        onOpenLauncher={() => setShowLauncher(true)}
        onQuickLaunch={() => void quickLaunch()}
      />

      <SubagentBar
        subagents={allSubs}
        activeProvider={activeProvider}
        activeTabId={activeTabId}
        inspectedSubagent={inspectedSubagent}
        onInspect={(sessionId, subagentId) => setInspectedSubagent({ sessionId, subagentId })}
      />

      {/* Main area: terminals */}
      <div className="app-main">
        <div className="terminal-column">
          <div className="terminal-area">
            {/* Terminal panels — always mounted, hidden via CSS (including dead ones so errors remain visible) */}
            {regularSessions.map((session) => (
              <TerminalPanel
                key={session.id}
                session={session}
                visible={session.id === activeTabId}
              />
            ))}

            {/* Subagent inspector overlay */}
            {activeSubagent && (
              <Suspense fallback={null}>
                <SubagentInspector
                  key={activeSubagent.id}
                  subagent={activeSubagent}
                  onClose={() => setInspectedSubagent(null)}
                />
              </Suspense>
            )}

            {/* Empty state — no active terminal visible */}
            {initialized && !regularSessions.some((s) => s.id === activeTabId) && (
              <div className="empty-state">
                <kbd>Ctrl+T</kbd> new session &middot; <kbd>Ctrl+Shift+R</kbd> resume from history
              </div>
            )}
          </div>
          <CommandBar
            sessionId={activeTabId}
            sessionState={activeSession?.state ?? "dead"}
            ctrlHeld={ctrlHeld}
          />
        </div>
        <RightPanel />
      </div>

      <StatusBar
        onOpenContextViewer={() => setShowContextViewer(true)}
        onOpenChangelog={() => setChangelogRequest({
          kind: "manual",
          initialCli: activeProvider,
          ranges: {},
        })}
      />

      {showLauncher && <SessionLauncher key={launcherGeneration} />}
      {showResumePicker && (
        <Suspense fallback={null}>
          <ResumePicker onClose={() => setShowResumePicker(false)} />
        </Suspense>
      )}
      {showPalette && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setShowPalette(false)} />
        </Suspense>
      )}
      {showConfigManager && (
        <Suspense fallback={null}>
          <ConfigManager />
        </Suspense>
      )}
      {changelogRequest && (
        <Suspense fallback={null}>
          <ChangelogModal
            request={changelogRequest}
            currentVersions={cliVersions}
            onClose={() => setChangelogRequest(null)}
          />
        </Suspense>
      )}
      {showContextViewer && activeSession && (
        <Suspense fallback={null}>
          <ContextViewer
            metadata={activeSession.metadata}
            subagents={subagentMap.get(activeSession.id) || []}
            sessionId={activeSession.id}
            cli={activeSession.config.cli}
            onClose={() => setShowContextViewer(false)}
          />
        </Suspense>
      )}

      {/* Worktree prune confirmation */}
      {pruneConfirm && (
        <PruneDialog
          request={pruneConfirm}
          onClose={() => setPruneConfirm(null)}
          onKeepWorktree={handleKeepWorktree}
          onPruneWorktree={handlePruneWorktree}
        />
      )}

      {/* Tab context menu portal */}
      {tabContextMenu && (
        <TabContextMenu
          menu={tabContextMenu}
          sessions={sessions}
          groups={groups}
          regularSessions={regularSessions}
          debugBuild={debugBuild}
          inspectorOffSessions={inspectorOffSessions}
          onClose={() => setTabContextMenu(null)}
          onCloseSession={handleCloseSession}
          onCloseSessionImmediate={closeSession}
          onSetLastConfig={setLastConfig}
          onSetInspectorOff={setInspectorOff}
          onSetShowLauncher={setShowLauncher}
        />
      )}
    </div>
  );
}
