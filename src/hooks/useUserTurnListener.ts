import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useActivityStore } from "../store/activity";
import { dlog } from "../lib/debugLog";

interface UserTurnPayload {
  endpoint: string;
}

// [AS-05] The proxy emits `user-turn-started-{sessionId}` when an actual
// /v1/messages or /v1/responses POST classified as a fresh user turn leaves
// the machine. Listening here moves `lastUserMessageAt` (which bounds the
// response activity panel) off the queue-time UserInput TAP event so a
// queued-then-erased message no longer prematurely clears the panel.
export function useUserTurnListener(sessionId: string | null): void {
  useEffect(() => {
    if (!sessionId) return;
    const sid = sessionId;

    const unlisten = listen<UserTurnPayload>(`user-turn-started-${sid}`, () => {
      useActivityStore.getState().markUserMessage(sid);
      dlog("activity", sid, "user-turn-started: response panel cleared", "DEBUG", {
        event: "activity.user_turn_started",
        data: {},
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [sessionId]);
}
