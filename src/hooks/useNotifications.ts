import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { dlog } from "../lib/debugLog";
import { useSessionStore } from "../store/sessions";
import { useSettingsStore } from "../store/settings";
import { settledStateManager } from "../lib/settledState";

/**
 * Sends native desktop notifications when background sessions
 * need attention — response completed, permission required, or error.
 *
 * Only notifies for sessions that are NOT the currently active/visible session.
 * Rate-limited to avoid notification spam (max one per session per 30s).
 *
 * Clicking a notification switches to the target tab and focuses the window.
 * [WN-03] Rate-limited 1/session/30s. Rust WinRT toast with on_activated callback.
 */
export function useNotifications() {
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const permissionCheckedRef = useRef(false);
  const permissionGrantedRef = useRef(false);
  const lastNotifyRef = useRef<Record<string, number>>({});
  const windowFocusedRef = useRef(true);

  // Check/request permission once on mount
  useEffect(() => {
    if (!notificationsEnabled || permissionCheckedRef.current) return;
    permissionCheckedRef.current = true;

    (async () => {
      let granted = await isPermissionGranted();
      if (!granted) {
        const result = await requestPermission();
        granted = result === "granted";
      }
      permissionGrantedRef.current = granted;
    })();
  }, [notificationsEnabled]);

  // Listen for notification clicks → switch tab + focus window
  useEffect(() => {
    const unlisten = listen<string>("notification-clicked", (event) => {
      const sessionId = event.payload;
      const store = useSessionStore.getState();
      if (!store.sessions.some((s) => s.id === sessionId)) return;

      store.setActiveTab(sessionId);

      const win = getCurrentWindow();
      win.unminimize().then(() => win.show()).then(() => win.setFocus()).catch(() => {});
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Track window focus for taskbar flash gating
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      windowFocusedRef.current = focused;
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Subscribe to settled-state changes for notifications
  useEffect(() => {
    if (!notificationsEnabled) return;

    const COOLDOWN_MS = 30_000;

    const unsub = settledStateManager.subscribe(
      (sessionId, kind) => {
        if (!permissionGrantedRef.current) return;

        const state = useSessionStore.getState();
        const session = state.sessions.find((s) => s.id === sessionId);
        if (!session || session.isMetaAgent) return;
        if (session.id === state.activeTabId) return;

        const now = Date.now();
        if (lastNotifyRef.current[sessionId] && now - lastNotifyRef.current[sessionId] < COOLDOWN_MS) return;

        let title: string | null = null;
        let body: string | null = null;

        if (kind === "idle") {
          title = `${session.name} — Response Complete`;
          body = session.metadata.currentAction || "Session is ready for input.";
        } else if (kind === "actionNeeded") {
          title = `${session.name} — Action Needed`;
          body = "A session needs your input.";
        } else if (kind === "waitingPermission") {
          title = `${session.name} — Permission Required`;
          body = "A session needs your permission to continue.";
        }

        if (title && body) {
          lastNotifyRef.current[sessionId] = now;
          invoke("send_notification", { title, body, sessionId });

          // [WN-04] Flash OS taskbar when window is not focused
          // [DR-08] Record notification-attention flashes in structured debug logs.
          if (!windowFocusedRef.current) {
            dlog("notify", sessionId, `taskbar flash: ${kind}`);
            getCurrentWindow()
              .requestUserAttention(UserAttentionType.Informational)
              .catch(() => {});
          }
        }
      },
      () => {}, // No action on clear
    );

    // Separate subscription for error state (not a settled kind)
    const unsubError = useSessionStore.subscribe((state) => {
      if (!permissionGrantedRef.current) return;
      const now = Date.now();

      for (const session of state.sessions) {
        if (session.isMetaAgent || session.id === state.activeTabId) continue;
        if (session.state !== "error") continue;
        if (lastNotifyRef.current[session.id] && now - lastNotifyRef.current[session.id] < COOLDOWN_MS) continue;

        lastNotifyRef.current[session.id] = now;
        invoke("send_notification", {
          title: `${session.name} — Error`,
          body: "A session encountered an error.",
          sessionId: session.id,
        });

        if (!windowFocusedRef.current) {
          dlog("notify", session.id, "taskbar flash: error");
          getCurrentWindow()
            .requestUserAttention(UserAttentionType.Informational)
            .catch(() => {});
        }
      }
    });

    return () => { unsub(); unsubError(); };
  }, [notificationsEnabled]);
}
