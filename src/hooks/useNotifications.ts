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

type NotificationKind = "idle" | "actionNeeded" | "waitingPermission" | "error";
type NotificationPayload = { title: string; body: string };

/**
 * Sends native desktop notifications when background sessions
 * need attention — response completed, permission required, or error.
 *
 * Only notifies for sessions that are NOT the currently active/visible session.
 * Rate-limited to avoid notification spam (max one per session per 30s).
 *
 * Clicking a notification switches to the target tab and focuses the window.
 * [WN-03] Rate-limited 1/session/30s. Rust native notification bridge emits
 * notification-clicked for supported platforms.
 */
export function useNotifications() {
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const permissionCheckedRef = useRef(false);
  const permissionGrantedRef = useRef(false);
  const lastNotifyRef = useRef(new Map<string, number>());
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
    const notifySession = (
      sessionId: string,
      kind: NotificationKind,
      buildPayload: (session: { name: string; metadata: { currentAction: string | null } }) => NotificationPayload | null,
    ) => {
      if (!permissionGrantedRef.current) return;

      const state = useSessionStore.getState();
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session || session.isMetaAgent) return;
      if (session.id === state.activeTabId) return;

      const now = Date.now();
      const lastNotifiedAt = lastNotifyRef.current.get(session.id);
      if (lastNotifiedAt && now - lastNotifiedAt < COOLDOWN_MS) return;

      const payload = buildPayload(session);
      if (!payload) return;

      lastNotifyRef.current.set(session.id, now);
      invoke("send_notification", { ...payload, sessionId: session.id });

      // [WN-04] Flash OS taskbar when window is not focused
      // [DR-08] Record notification-attention flashes in structured debug logs.
      if (!windowFocusedRef.current) {
        dlog("notify", session.id, `taskbar flash: ${kind}`);
        getCurrentWindow()
          .requestUserAttention(UserAttentionType.Informational)
          .catch(() => {});
      }
    };

    const unsub = settledStateManager.subscribe(
      (sessionId, kind) => {
        notifySession(sessionId, kind, (session) => {
          if (kind === "idle") {
            return {
              title: `${session.name} — Response Complete`,
              body: session.metadata.currentAction || "Session is ready for input.",
            };
          }
          if (kind === "actionNeeded") {
            return {
              title: `${session.name} — Action Needed`,
              body: "A session needs your input.",
            };
          }
          if (kind === "waitingPermission") {
            return {
              title: `${session.name} — Permission Required`,
              body: "A session needs your permission to continue.",
            };
          }
          return null;
        });
      },
      () => {}, // No action on clear
    );

    // Separate subscription for error state (not a settled kind)
    const unsubError = useSessionStore.subscribe((state) => {
      const liveSessionIds = new Set(state.sessions.map((session) => session.id));
      for (const sessionId of lastNotifyRef.current.keys()) {
        if (!liveSessionIds.has(sessionId)) lastNotifyRef.current.delete(sessionId);
      }

      for (const session of state.sessions) {
        if (session.state !== "error") continue;
        notifySession(session.id, "error", (target) => {
          return {
            title: `${target.name} — Error`,
            body: "A session encountered an error.",
          };
        });
      }
    });

    return () => { unsub(); unsubError(); };
  }, [notificationsEnabled]);
}
