import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { INSTALL_TAPS, tapToggleExpr, tapToggleAllExpr } from "../lib/inspectorHooks";
import type { TapCategory } from "../lib/inspectorHooks";
import { classifyTapEntry } from "../lib/tapClassifier";
import { tapEventBus } from "../lib/tapEventBus";
import { dlog } from "../lib/debugLog";
import type { TapEntry } from "../types/tapEvents";

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_THRESHOLD = 50;

const ALL_CATEGORIES: TapCategory[] = ["parse", "stringify", "console", "fs", "spawn", "fetch", "exit", "timer", "stdout", "stderr", "require", "bun", "websocket", "net", "stream"];

interface TapPipelineOptions {
  sessionId: string | null;
  wsSend: (method: string, params?: Record<string, unknown>) => number;
  connected: boolean;
  categories: Set<string>; // empty = recording disabled (but core parse+stringify still run for state)
}

// [IN-10] Tap event pipeline: TCP -> classify -> dispatch -> disk
// [SI-14] Push-based: events arrive via Tauri events from Rust TCP tap server
/**
 * Manages the tap pipeline: install hooks via inspector WebSocket,
 * receive events via dedicated TCP channel (Tauri events),
 * classify into typed events, dispatch to tapEventBus, and buffer for disk recording.
 *
 * Core categories (parse, stringify) are always on for state detection.
 * Optional categories are toggled by the user for disk recording.
 * Events arrive via per-session Tauri events from the Rust TCP tap server.
 */
export function useTapPipeline({
  sessionId,
  wsSend,
  connected,
  categories,
}: TapPipelineOptions): void {
  const tapsInstalledRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<TapEntry[]>([]);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const prevCatsRef = useRef<Set<string>>(new Set());

  const flush = useCallback(async () => {
    const entries = pendingRef.current;
    if (entries.length === 0 || !sessionIdRef.current) return;
    pendingRef.current = [];

    const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    try {
      await invoke("append_tap_data", {
        sessionId: sessionIdRef.current,
        lines,
      });
    } catch (e) {
      dlog("tap", sessionIdRef.current, `flush error: ${e}`, "WARN");
    }
  }, []);

  const startFlushTimer = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(function tick() {
      flush();
      flushTimerRef.current = setTimeout(tick, FLUSH_INTERVAL_MS);
    }, FLUSH_INTERVAL_MS);
  }, [flush]);

  const stopFlushTimer = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  // Listen for tap events from the Rust TCP server via session-scoped Tauri events
  useEffect(() => {
    if (!sessionId) return;
    const sid = sessionId;

    const unlisten = listen<string>(`tap-entry-${sid}`, (event) => {
      const line = event.payload;
      try {
        const entry = JSON.parse(line) as TapEntry;

        // 1. Classify → dispatch (always, drives state)
        const classified = classifyTapEntry(entry);
        if (classified && sessionIdRef.current) {
          tapEventBus.dispatch(sessionIdRef.current, classified);
        }

        // 2. Buffer for disk (only if recording enabled for this category)
        const cat = entry.cat;
        const cats = prevCatsRef.current;
        if (cats.size > 0) {
          const isCoreCat = cat === "parse" || cat === "stringify";
          if (isCoreCat || cats.has(cat)) {
            pendingRef.current.push(entry);
            if (pendingRef.current.length >= FLUSH_THRESHOLD) {
              flush();
            }
          }
        }
      } catch {
        // Invalid JSON line — skip
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [sessionId, flush]);

  // Install taps on first connect + sync category flags
  useEffect(() => {
    if (!connected || !sessionId) return;
    const prev = prevCatsRef.current;
    const next = categories;

    // Always install taps on connect (parse+stringify are always-on for state)
    if (!tapsInstalledRef.current) {
      wsSend("Runtime.evaluate", { expression: INSTALL_TAPS, returnByValue: true });
      tapsInstalledRef.current = true;
      dlog("tap", sessionId, "taps installed (parse+stringify always-on)");

      // Diagnostic: check TCP connection state after a short delay
      const diagSid = sessionId;
      setTimeout(() => {
        const diagId = wsSend("Runtime.evaluate", {
          expression: "JSON.stringify(globalThis.__tapDiag || 'no-diag')",
          returnByValue: true,
        });
        dlog("tap", diagSid, `tap diag requested (msgId=${diagId})`, "DEBUG");
      }, 2000);
    }

    // Toggle individual optional categories that changed
    for (const cat of ALL_CATEGORIES) {
      if (cat === "parse" || cat === "stringify") continue; // always on
      const wasOn = prev.has(cat);
      const isOn = next.has(cat);
      if (wasOn !== isOn) {
        wsSend("Runtime.evaluate", {
          expression: tapToggleExpr(cat, isOn),
          returnByValue: true,
        });
      }
    }

    // Start or stop disk flush timer based on recording state
    if (next.size > 0 && !flushTimerRef.current) {
      startFlushTimer();
      dlog("tap", sessionId, `tap recording: ${[...next].join(",")}`);
    } else if (next.size === 0 && flushTimerRef.current) {
      stopFlushTimer();
      flush();
      dlog("tap", sessionId, "tap recording stopped");
    }

    prevCatsRef.current = new Set(next);
  }, [categories, connected, sessionId, wsSend, startFlushTimer, stopFlushTimer, flush]);

  // Cleanup on disconnect
  useEffect(() => {
    if (!connected) {
      stopFlushTimer();
      flush();
      tapsInstalledRef.current = false;
      prevCatsRef.current = new Set();
    }
  }, [connected, stopFlushTimer, flush]);

  // Cleanup on unmount: disable optional flags, flush pending
  useEffect(() => {
    return () => {
      if (tapsInstalledRef.current) {
        wsSend("Runtime.evaluate", { expression: tapToggleAllExpr(false), returnByValue: true });
      }
      stopFlushTimer();
      flush();
    };
  }, [wsSend, stopFlushTimer, flush]);
}
