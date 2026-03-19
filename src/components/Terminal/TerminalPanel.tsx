import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTerminal } from "../../hooks/useTerminal";
import { usePty } from "../../hooks/usePty";
import { useClaudeState } from "../../hooks/useClaudeState";
import { useSubagentWatcher } from "../../hooks/useSubagentWatcher";
import { useSessionStore } from "../../store/sessions";
import { useSettingsStore } from "../../store/settings";
import { buildClaudeArgs, getResumeId } from "../../lib/claude";
import { registerPtyWriter, unregisterPtyWriter } from "../../lib/ptyRegistry";
import { registerBufferReader, unregisterBufferReader } from "../../lib/terminalRegistry";
import type { Session, SessionConfig, SessionState } from "../../types/session";
import "@xterm/xterm/css/xterm.css";
import "./TerminalPanel.css";

interface TerminalPanelProps {
  session: Session;
  visible: boolean;
}

// ── State Banner ────────────────────────────────────────────────────────
// Low-text: icon-first, tool name is acceptable (it's a value)

function StateBanner({ session }: { session: Session }) {
  const tool = session.metadata.currentToolName;

  let content: { icon: string; text: string | null; className: string } | null;
  switch (session.state) {
    case "thinking":
      content = { icon: "●", text: null, className: "banner-thinking" };
      break;
    case "toolUse":
      content = {
        icon: "⚙",
        text: tool || null,
        className: `banner-tool banner-tool-${(tool || "").toLowerCase()}`,
      };
      break;
    case "waitingPermission":
      content = { icon: "⏸", text: null, className: "banner-permission" };
      break;
    case "error":
      content = { icon: "⚠", text: null, className: "banner-error" };
      break;
    default:
      content = null;
  }

  if (!content) return null;

  return (
    <div className={`state-banner ${content.className}`}>
      <span className="banner-icon">{content.icon}</span>
      {content.text && <span>{content.text}</span>}
    </div>
  );
}

// ── Duration Timer (active time only) ────────────────────────────────────

const ACTIVE_STATES = new Set<SessionState>(["thinking", "toolUse", "waitingPermission", "error"]);

function useDurationTimer(sessionId: string, state: SessionState) {
  const updateMetadata = useSessionStore((s) => s.updateMetadata);
  const accumulatedRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const lastStateRef = useRef(state);

  // Track state changes so we know when we transition active↔idle
  lastStateRef.current = state;

  useEffect(() => {
    if (state === "dead") return;

    const interval = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      if (ACTIVE_STATES.has(lastStateRef.current)) {
        accumulatedRef.current += dt;
        const secs = Math.floor(accumulatedRef.current);
        updateMetadata(sessionId, { durationSecs: secs });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionId, state === "dead", updateMetadata]);

  return Math.floor(accumulatedRef.current);
}

// ── Terminal Panel ──────────────────────────────────────────────────────

export function TerminalPanel({ session, visible }: TerminalPanelProps) {
  const claudePath = useSessionStore((s) => s.claudePath);
  const updateState = useSessionStore((s) => s.updateState);
  const updateConfig = useSessionStore((s) => s.updateConfig);
  const renameSession = useSessionStore((s) => s.renameSession);
  const updateMetadata = useSessionStore((s) => s.updateMetadata);
  const respawnRequest = useSessionStore((s) => s.respawnRequest);
  const clearRespawnRequest = useSessionStore((s) => s.clearRespawnRequest);
  const closeSession = useSessionStore((s) => s.closeSession);
  const spawnedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isResumed = !!session.config.resumeSession;
  const watchedJsonlIdRef = useRef(getResumeId(session));
  const [respawnCounter, setRespawnCounter] = useState(0);
  const [hasConversation, setHasConversation] = useState(false);
  const spawnTimestampRef = useRef(Date.now());
  const resumePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopResumePolling = useCallback(() => {
    if (resumePollingRef.current) { clearInterval(resumePollingRef.current); resumePollingRef.current = null; }
  }, []);

  // Switch JSONL watcher to a new session file (plan mode, /resume detection)
  // resumed=true suppresses updates until caught-up (for /resume with history)
  // resumed=false starts caught-up immediately (for plan-mode continuation with fresh file)
  const switchJsonlWatcher = useCallback((newJsonlId: string, resumed = true) => {
    invoke("stop_jsonl_watcher", { sessionId: session.id }).catch(() => {});
    claudeState.reset(resumed);
    invoke("start_jsonl_watcher", {
      sessionId: session.id,
      workingDir: session.config.workingDir,
      jsonlSessionId: newJsonlId,
    });
    watchedJsonlIdRef.current = newJsonlId;
    // Pick up tab name from matching dead tab
    const sessions = useSessionStore.getState().sessions;
    const match = sessions.find((s) =>
      s.state === "dead" && s.id !== session.id && getResumeId(s) === newJsonlId
    );
    if (match?.metadata.nodeSummary) {
      renameSession(session.id, match.name);
      updateMetadata(session.id, { nodeSummary: match.metadata.nodeSummary });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.config.workingDir, renameSession, updateMetadata]);

  // When a result event fires (conversation ended) but the PTY is still alive,
  // check if Claude forked into a new JSONL file (plan mode, continuation).
  // The new file's first events reference the old sessionId — this is how we link them.
  const handleConversationEnd = useCallback(() => {
    if (session.config.runMode) return;
    if (session.state === "dead") return;
    invoke<string | null>("find_continuation_session", {
      sessionId: watchedJsonlIdRef.current,
      workingDir: session.config.workingDir,
    }).then((newJsonlId) => {
      if (newJsonlId && newJsonlId !== watchedJsonlIdRef.current) {
        // Plan-mode continuation: fresh JSONL file, no history to replay
        switchJsonlWatcher(newJsonlId, false);
        return;
      }
      // No continuation found — might be /resume, check latest JSONL after short delay
      setTimeout(() => {
        invoke<string>("find_active_jsonl_session", {
          workingDir: session.config.workingDir,
          sinceMs: spawnTimestampRef.current,
        }).then((latestId) => {
          if (latestId && latestId !== watchedJsonlIdRef.current) {
            switchJsonlWatcher(latestId);
          }
        }).catch(() => {});
      }, 2000);
    }).catch(() => {});
  }, [session.state, session.config.workingDir, switchJsonlWatcher]);

  const handleCaughtUp = useCallback(() => setLoading(false), []);
  const claudeState = useClaudeState(session.id, isResumed, { onConversationEnd: handleConversationEnd, onCaughtUp: handleCaughtUp });
  const { feed } = claudeState;
  const [loading, setLoading] = useState(isResumed);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [queuedInput, setQueuedInput] = useState<string | null>(null);

  // Start subagent JSONL watcher — uses the app's session ID directly.
  // For new sessions: --session-id matches, subagents go under our ID's dir.
  // For resumed sessions: subagents from the NEW conversation go under the new ID.
  // Pass resumeSession as the JSONL session ID for subagent directory lookup.
  // Subagents live under the CLI's session ID, not our internal app ID.
  useSubagentWatcher(session.id, session.config.workingDir, session.config.resumeSession || session.config.sessionId || null);

  // Duration timer
  useDurationTimer(session.id, session.state);

  const decoder = useRef(new TextDecoder());

  // Use a ref to break the circular dependency:
  // handlePtyData needs terminal, terminal needs handleTermData, which needs pty,
  // and pty needs handlePtyData. We use terminalRef to avoid forward-referencing.
  const terminalRef = useRef<ReturnType<typeof useTerminal> | null>(null);
  // Buffer PTY data for background tabs — skip xterm.js writes when not visible,
  // flush in one write when the tab becomes visible. Saves O(N) rendering cost.
  const visibleRef = useRef(visible);
  const bgBufferRef = useRef<Uint8Array[]>([]);
  visibleRef.current = visible;

  const handlePtyData = useCallback(
    (data: Uint8Array) => {
      const text = decoder.current.decode(data, { stream: true });
      // Always feed text for JSONL state/permission detection regardless of visibility
      feed(text);
      // Only write to xterm.js if the tab is visible; buffer otherwise
      if (visibleRef.current) {
        terminalRef.current?.writeBytes(data);
      } else {
        bgBufferRef.current.push(data);
      }
    },
    [feed]
  );

  const handlePtyExit = useCallback(
    (_info: { exitCode: number }) => {
      // Cascade dead state to all subagents so they get cleaned up from canvas
      const subagents = useSessionStore.getState().subagents.get(session.id) || [];
      const { updateSubagent } = useSessionStore.getState();
      for (const sub of subagents) {
        updateSubagent(session.id, sub.id, { state: "dead" });
      }
      updateState(session.id, "dead");
      // Check if session has conversation content for the overlay's Resume button
      const resumeId = getResumeId(session);
      invoke<boolean>("session_has_conversation", {
        sessionId: resumeId,
        workingDir: session.config.workingDir,
      }).then((has) => { setHasConversation(has); }).catch(() => {});
    },
    [session.id, session.config.resumeSession, session.config.sessionId, session.config.workingDir, updateState]
  );

  const pty = usePty({ onData: handlePtyData, onExit: handlePtyExit });

  // ── In-tab respawn ────────────────────────────────────────────────────
  const triggerRespawnRef = useRef<(config?: SessionConfig, name?: string) => void>(() => {});
  // Stable ref so callbacks can call triggerRespawn without stale closures
  triggerRespawnRef.current = (config?: SessionConfig, name?: string) => {
    // 1. Clean up old PTY, watchers, and active polling
    pty.cleanup();
    invoke("stop_jsonl_watcher", { sessionId: session.id }).catch(() => {});
    invoke("stop_subagent_watcher", { sessionId: session.id }).catch(() => {});
    unregisterPtyWriter(session.id);
    stopResumePolling();

    // 2. Determine config (default: resume same session)
    const newConfig: SessionConfig = config ?? {
      ...session.config,
      resumeSession: hasConversation ? getResumeId(session) : null,
      continueSession: false,
    };

    // 3. Update session in store
    updateConfig(session.id, newConfig);
    if (name) renameSession(session.id, name);

    // 4. Visual feedback + loading spinner for resumed sessions
    terminalRef.current?.write("\r\n\x1b[90m[Resuming...]\x1b[0m\r\n");
    setLoading(!!newConfig.resumeSession);

    // 5. Reset internal state and JSONL accumulator
    const isResume = !!newConfig.resumeSession;
    spawnedRef.current = false;
    watchedJsonlIdRef.current = newConfig.resumeSession || newConfig.sessionId || session.id;
    setHasConversation(false);
    claudeState.reset(isResume);
    spawnTimestampRef.current = Date.now();

    // 6. Trigger re-spawn
    updateState(session.id, "starting");
    setRespawnCounter((c) => c + 1);
  };

  // Track user input for slash command detection
  const inputBufRef = useRef("");
  const recordCommandUsage = useSettingsStore((s) => s.recordCommandUsage);

  // Start polling for JSONL session switch (after /resume command)
  const startJsonlPolling = useCallback(() => {
    if (resumePollingRef.current) return;
    let elapsed = 0;
    resumePollingRef.current = setInterval(() => {
      elapsed += 3000;
      if (elapsed > 30000) {
        // Timeout — stop polling
        stopResumePolling();
        return;
      }
      invoke<string>("find_active_jsonl_session", {
        workingDir: session.config.workingDir,
        sinceMs: spawnTimestampRef.current,
      }).then((latestId) => {
        if (latestId && latestId !== watchedJsonlIdRef.current) {
          switchJsonlWatcher(latestId);
          stopResumePolling();
        }
      }).catch(() => {});
    }, 3000);
  }, [session.config.workingDir, switchJsonlWatcher, stopResumePolling]);

  const handleTermData = useCallback(
    (data: string) => {
      // Swallow all input when session is dead (overlay handles actions)
      if (session.state === "dead") {
        if (!session.config.runMode && (data === "\r" || data === "\n")) {
          triggerRespawnRef.current();
        }
        return;
      }
      pty.handle.current?.write(data);
      // Buffer user input to detect slash commands typed directly in terminal
      for (const ch of data) {
        if (ch === "\r" || ch === "\n") {
          const trimmed = inputBufRef.current.trim();
          if (trimmed.startsWith("/") && trimmed.length >= 3 && !trimmed.includes(" ")) {
            recordCommandUsage(trimmed);
          }
          // Detect /resume to start JSONL polling
          if (trimmed === "/resume") {
            startJsonlPolling();
          }
          inputBufRef.current = "";
        } else if (ch === "\x7f" || ch === "\b") {
          // Backspace
          inputBufRef.current = inputBufRef.current.slice(0, -1);
        } else if (ch >= " ") {
          inputBufRef.current += ch;
        }
      }
    },
    // pty.handle is a stable ref — omitted from deps intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.state, recordCommandUsage, startJsonlPolling]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      pty.handle.current?.resize(cols, rows);
    },
    // pty.handle is a stable ref — omitted from deps intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const terminal = useTerminal({
    onData: handleTermData,
    onResize: handleResize,
  });
  terminalRef.current = terminal;

  // Attach terminal to container
  const setContainer = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      terminal.attach(el);
    },
    [terminal]
  );

  // Spawn PTY once + start JSONL watcher (respawnCounter triggers re-spawn)
  useEffect(() => {
    if (spawnedRef.current || !claudePath) return;

    const doSpawn = async () => {
      spawnedRef.current = true;
      try {
        const args = await buildClaudeArgs(session.config);
        const { cols, rows } = terminal.getDimensions();
        // Normalize path slashes for Windows PTY spawn
        const cwd = session.config.workingDir.replace(/\//g, "\\");
        const handle = pty.spawn(claudePath, args, cwd, cols, rows);
        registerPtyWriter(session.id, handle.write);
        spawnTimestampRef.current = Date.now();
        updateState(session.id, "idle");

        // Start JSONL file watcher for structured metadata (skip for run-mode).
        // For resumed sessions, watch the original session's JSONL file.
        if (!session.config.runMode) {
          invoke("start_jsonl_watcher", {
            sessionId: session.id,
            workingDir: session.config.workingDir,
            jsonlSessionId: session.config.resumeSession || null,
          });
        }
      } catch (err) {
        console.error("Failed to spawn PTY:", err);
        updateState(session.id, "error");
        terminal.write(
          `\r\n\x1b[31mFailed to start Claude: ${err}\x1b[0m\r\n`
        );
      }
    };

    const timer = setTimeout(doSpawn, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claudePath, session.id, respawnCounter]);

  // Register terminal buffer reader for transcript export
  useEffect(() => {
    registerBufferReader(session.id, terminal.getBufferText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, terminal.getBufferText]);

  // Cleanup PTY, JSONL watcher, and terminal registry on unmount
  useEffect(() => {
    const id = session.id;
    return () => {
      invoke("stop_jsonl_watcher", { sessionId: id });
      unregisterPtyWriter(id);
      unregisterBufferReader(id);
      pty.cleanup();
      stopResumePolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch for respawn requests from ResumePicker or other components
  useEffect(() => {
    if (respawnRequest?.tabId === session.id && session.state === "dead") {
      clearRespawnRequest();
      triggerRespawnRef.current(respawnRequest.config, respawnRequest.name);
    }
  }, [respawnRequest, session.state, session.id, clearRespawnRequest]);

  // Re-fit and focus when becoming visible — only depends on visible and session.id.
  // terminal is NOT in deps because useTerminal returns a new object on every render,
  // which would cause this effect to re-fire on every store update, calling fit()
  // repeatedly and flashing the terminal.
  useEffect(() => {
    if (visible) {
      terminal.fit();  // resize BEFORE write to avoid reflow losing queued data
      // Flush background buffer — write all buffered data in one batch
      const chunks = bgBufferRef.current;
      if (chunks.length > 0) {
        bgBufferRef.current = [];
        let totalLen = 0;
        for (const c of chunks) totalLen += c.length;
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) { merged.set(c, offset); offset += c.length; }
        terminal.termRef.current?.write(merged);
      }
      terminal.termRef.current?.scrollToBottom();
      terminal.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session.id]);

  // Fix GPU texture corruption after OS sleep / display power-off.
  // clearTextureAtlas() rebuilds the glyph atlas (xterm.js docs recommend
  // this for Chromium/Nvidia sleep bugs), refresh() forces a full redraw.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !visible) return;
      const term = terminal.termRef.current;
      if (!term) return;
      term.clearTextureAtlas();
      term.refresh(0, term.rows - 1);
      terminal.fit();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // terminal is NOT in deps — useTerminal returns a new object each render.
    // visible is needed to re-capture its value in the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Queue input handler: capture typed text, or cancel if already queued
  const handleQueueInput = useCallback(() => {
    if (queuedInput) {
      setQueuedInput(null);
      return;
    }
    const text = inputBufRef.current.trim();
    if (!text) return;
    inputBufRef.current = "";
    pty.handle.current?.write("\x15"); // Clear terminal input line
    setQueuedInput(text);
    // pty.handle is a stable ref — omitted from deps intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedInput]);

  // Auto-send queued input when session becomes idle, clear if session dies
  useEffect(() => {
    if (!queuedInput) return;
    if (session.state === "dead") { setQueuedInput(null); return; }
    if (session.state !== "idle") return;
    const timer = setTimeout(() => {
      pty.handle.current?.write(queuedInput + "\r");
      setQueuedInput(null);
    }, 800);
    return () => clearTimeout(timer);
    // pty.handle is a stable ref — omitted from deps intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.state, queuedInput]);

  // Poll scroll position to show/hide scroll-to-bottom button
  useEffect(() => {
    if (!visible) return;
    const check = () => setShowScrollBtn(!terminal.isAtBottom());
    const interval = setInterval(check, 300);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Reclaim focus when terminal is visible but loses it to non-interactive elements.
  // Uses termRef directly instead of terminal (which is a new object every render).
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    const handleFocusOut = () => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
        // Don't reclaim focus if a modal overlay is open
        if (document.querySelector('.launcher-overlay, .resume-picker-overlay, .hooks-overlay, .palette-overlay')) return;
        terminal.termRef.current?.focus();
      });
    };

    const container = containerRef.current;
    container?.addEventListener("focusout", handleFocusOut);
    return () => {
      cancelled = true;
      container?.removeEventListener("focusout", handleFocusOut);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session.id]);

  const showDeadOverlay = session.state === "dead" && visible;

  return (
    <div
      className="terminal-panel"
      style={{ display: visible ? "flex" : "none" }}
    >
      <StateBanner session={session} />
      {loading && visible && (
        <div className="terminal-loading">
          <div className="terminal-loading-spinner" />
          <span>Loading conversation...</span>
        </div>
      )}
      <div className="terminal-container" ref={setContainer} />
      {showDeadOverlay && session.config.runMode && (
        <div className="dead-overlay dead-overlay-run">
          <div className="dead-overlay-card">
            <div className="dead-overlay-title">Command complete</div>
            <div className="dead-overlay-actions">
              <button className="dead-overlay-btn" onClick={() => closeSession(session.id)}>
                Close tab
              </button>
            </div>
            <div className="dead-overlay-hint">
              <kbd>Ctrl+W</kbd> close
            </div>
          </div>
        </div>
      )}
      {showDeadOverlay && !session.config.runMode && (
        <div className="dead-overlay">
          <div className="dead-overlay-card">
            <div className="dead-overlay-title">Session ended</div>
            <div className="dead-overlay-actions">
              {hasConversation && (
                <button
                  className="dead-overlay-btn dead-overlay-btn-primary"
                  onClick={() => triggerRespawnRef.current()}
                >
                  Resume
                </button>
              )}
              <button
                className="dead-overlay-btn"
                onClick={() => {
                  // Trigger Ctrl+R — App.tsx handles opening the resume picker
                  window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true }));
                }}
              >
                Resume other...
              </button>
            </div>
            <div className="dead-overlay-actions">
              <button
                className="dead-overlay-btn"
                onClick={() => {
                  const freshConfig: SessionConfig = {
                    ...session.config,
                    resumeSession: null,
                    continueSession: false,
                    sessionId: null,
                  };
                  triggerRespawnRef.current(freshConfig);
                }}
              >
                New session
              </button>
            </div>
            <div className="dead-overlay-hint">
              {hasConversation ? (
                <><kbd>Enter</kbd> resume &middot; <kbd>Ctrl+R</kbd> browse</>
              ) : (
                <><kbd>Ctrl+R</kbd> browse</>
              )}
            </div>
          </div>
        </div>
      )}
      {showScrollBtn && (
        <button
          className="scroll-to-bottom-btn"
          onClick={() => terminal.scrollToBottom()}
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
      {!showScrollBtn && visible && session.state !== "dead" && (
        <div className="clear-input-zone">
          <button
            className={`queue-input-btn${queuedInput ? " queue-input-btn-active" : ""}`}
            onClick={handleQueueInput}
            title={queuedInput ? `Queued: "${queuedInput}" (click to cancel)` : "Queue input for idle send"}
          >
            ⏎
          </button>
          <button
            className="clear-input-btn"
            onClick={() => pty.handle.current?.write("\x15")}
            title="Clear input line (Ctrl+U)"
          >
            ⌫
          </button>
        </div>
      )}
    </div>
  );
}
