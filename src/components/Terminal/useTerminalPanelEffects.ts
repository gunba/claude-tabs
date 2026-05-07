import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect } from "react";
import { dlog } from "../../lib/debugLog";
import { unregisterInspectorCallbacks, unregisterInspectorPort } from "../../lib/inspectorPort";
import {
  unregisterPtyHandleId,
  unregisterPtyKill,
  unregisterPtyWriter,
} from "../../lib/ptyRegistry";
import {
  registerBufferReader,
  registerTerminal,
  unregisterBufferReader,
  unregisterTerminal,
} from "../../lib/terminalRegistry";
import { useSessionStore } from "../../store/sessions";
import type { SessionState } from "../../types/session";
import type { PtyController, TerminalController } from "./terminalPanelTypes";

interface UseTerminalPanelEffectsParams {
  pty: PtyController;
  sessionId: string;
  sessionState: SessionState;
  terminal: TerminalController;
  visible: boolean;
}

export function useTerminalPanelEffects({
  pty,
  sessionId,
  sessionState,
  terminal,
  visible,
}: UseTerminalPanelEffectsParams): void {
  const killRequest = useSessionStore((s) => s.killRequest);
  const clearKillRequest = useSessionStore((s) => s.clearKillRequest);

  // Register terminal buffer reader and terminal instance for search/render-wait
  useEffect(() => {
    registerBufferReader(sessionId, terminal.getBufferText);
    if (terminal.termRef.current) {
      registerTerminal(sessionId, terminal.termRef.current);
    }
    return () => {
      unregisterBufferReader(sessionId);
      unregisterTerminal(sessionId);
    };
  }, [sessionId, terminal.getBufferText, terminal.termGeneration, terminal.termRef]);

  // Cleanup PTY and registries on unmount
  useEffect(() => {
    const id = sessionId;
    return () => {
      invoke("stop_tap_server", { sessionId: id }).catch(() => {});
      invoke("stop_codex_rollout", { sessionId: id }).catch(() => {});
      unregisterPtyWriter(id);
      unregisterPtyKill(id);
      unregisterPtyHandleId(id);
      unregisterInspectorPort(id);
      unregisterInspectorCallbacks(id);
      dlog("terminal", id, "terminal panel unmount cleanup", "DEBUG", {
        event: "terminal.unmount_cleanup",
        data: { sessionId: id },
      });
      pty.cleanup();
    };
  }, [pty.cleanup, sessionId]);

  // Watch for kill requests from the tab bar
  useEffect(() => {
    if (killRequest === sessionId && sessionState !== "dead") {
      clearKillRequest();
      dlog("terminal", sessionId, "kill effect triggered");
      pty.cleanup();
      // pty.kill() fires exitCallback -> handlePtyExit -> state "dead"
    }
  }, [killRequest, sessionId, sessionState, clearKillRequest, pty.cleanup]);

  // Keep focus on the visible terminal; attach/fit is handled by the terminal lifecycle.
  useEffect(() => {
    if (!visible) return;
    dlog("terminal", sessionId, "panel became visible", "DEBUG", {
      event: "terminal.visible",
      data: { visible },
    });
    terminal.focus();
  }, [visible, sessionId, terminal.focus, terminal.termGeneration]);

}

export function useTerminalContainer(terminal: TerminalController): {
  setContainer: (el: HTMLDivElement | null) => void;
} {
  const setContainer = useCallback(
    (el: HTMLDivElement | null) => {
      terminal.attach(el);
    },
    [terminal.attach]
  );

  return { setContainer };
}
