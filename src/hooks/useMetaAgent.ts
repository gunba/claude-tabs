import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessions";
import { useSettingsStore } from "../store/settings";
import { sessionFingerprint } from "../lib/metaAgentUtils";
import { dirToTabName } from "../lib/claude";

const DEBOUNCE_MS = 15_000;
const MIN_SESSIONS = 1;

/**
 * Manages an on-demand Haiku summariser that analyzes active sessions
 * and updates their `nodeSummary` metadata for the graph canvas.
 *
 * Triggers contextually:
 * - When a session transitions from active (thinking/toolUse) to idle
 * - When sessions are added or removed
 * - NOT when nothing has changed since the last summary
 *
 * Uses one-shot Claude CLI pipe mode per invocation.
 */
export function useMetaAgent(): { isRunning: boolean } {
  const updateMetadata = useSessionStore((s) => s.updateMetadata);

  const isRunningRef = useRef(false);
  const lastFingerprintRef = useRef("");
  const lastTriggerRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);

  const processResponse = useCallback((response: string) => {
    const renameSession = useSessionStore.getState().renameSession;
    // Try to extract JSON from the response (Haiku may wrap in markdown code fences)
    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    try {
      const parsed = JSON.parse(jsonStr);
      const summaries: Record<string, string> | undefined = parsed.summaries;
      const names: Record<string, string> | undefined = parsed.names;

      if (summaries && typeof summaries === "object") {
        for (const [sessionId, summary] of Object.entries(summaries)) {
          if (typeof summary === "string" && summary.length > 0) {
            updateMetadata(sessionId, { nodeSummary: summary });
          }
        }
      }

      // Apply smart names for sessions still using default directory names
      if (names && typeof names === "object") {
        for (const [sessionId, name] of Object.entries(names)) {
          if (typeof name === "string" && name.length > 0 && name.length <= 30) {
            const session = useSessionStore
              .getState()
              .sessions.find((s) => s.id === sessionId);
            if (session) {
              const defaultName = dirToTabName(session.config.workingDir);
              if (session.name === defaultName) {
                renameSession(sessionId, name);
              }
            }
          }
        }
      }
    } catch {
      // Not valid JSON — log for debugging
      console.warn("[useMetaAgent] Failed to parse Haiku response:", response.slice(0, 200));
    }
  }, [updateMetadata]);

  const sendPrompt = useCallback(async () => {
    const sessions = useSessionStore.getState().sessions;
    const claudePath = useSessionStore.getState().claudePath;
    const targetSessions = sessions.filter((s) => !s.isMetaAgent && s.state !== "dead");

    if (targetSessions.length === 0 || !claudePath) return;

    // Check fingerprint — don't re-summarise if nothing changed
    const fp = sessionFingerprint(targetSessions);
    if (fp === lastFingerprintRef.current) return;
    lastFingerprintRef.current = fp;

    // Identify sessions still using default directory-basename names
    // Only name sessions that have had at least 2 assistant messages (actual conversation)
    const needsNaming = targetSessions.filter(
      (s) => s.name === dirToTabName(s.config.workingDir) && s.metadata.assistantMessageCount >= 2
    );

    // Build compact prompt
    const sessionsJson = targetSessions.map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      action: s.metadata.currentAction || "none",
      output: (s.metadata.recentOutput || "").slice(0, 150).replace(/\n/g, " "),
      summary: s.metadata.nodeSummary || "none",
    }));

    const needsNamingIds = needsNaming.map((s) => s.id);
    const namingPart = needsNamingIds.length > 0
      ? ` Also name sessions with default dir names: ${needsNamingIds.join(",")}.`
      : "";

    const prompt = `Summarize: ${JSON.stringify(sessionsJson)}.${namingPart} Return JSON: {"summaries":{"<id>":"<summary>"}${needsNamingIds.length > 0 ? ',"names":{"<id>":"<name>"}' : ""}}`;
    const systemPrompt = "You summarize Claude Code sessions. Return only valid JSON, no markdown, no explanation.";

    try {
      isRunningRef.current = true;
      const cwd = useSettingsStore.getState().lastConfig.workingDir || ".";

      const response = await invoke<string>("invoke_claude_pipe", {
        claudePath,
        prompt,
        systemPrompt,
        model: "haiku",
        workingDir: cwd,
      });
      processResponse(response);
    } catch (err) {
      console.error("[useMetaAgent] Haiku failed:", err);
    } finally {
      isRunningRef.current = false;
    }
  }, [processResponse]);

  // Debounced trigger function
  const triggerSummary = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastTriggerRef.current;

    if (elapsed >= DEBOUNCE_MS) {
      lastTriggerRef.current = now;
      sendPrompt();
    } else {
      // Schedule for later if not already pending
      if (!pendingRef.current) {
        pendingRef.current = true;
        debounceTimerRef.current = setTimeout(() => {
          pendingRef.current = false;
          lastTriggerRef.current = Date.now();
          sendPrompt();
        }, DEBOUNCE_MS - elapsed);
      }
    }
  }, [sendPrompt]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  // Subscribe to session state changes and trigger contextually
  useEffect(() => {
    let prevFingerprint = "";
    // Track the assistantMessageCount at which we last summarised each session,
    // so we can re-trigger every RESUMMARISE_INTERVAL messages as conversations drift.
    const lastSummarisedAt: Record<string, number> = {};
    const RESUMMARISE_INTERVAL = 10;

    const unsub = useSessionStore.subscribe((state) => {
      const sessions = state.sessions.filter((s) => !s.isMetaAgent);

      // Don't trigger if no sessions, all starting, or none have conversation data
      if (
        sessions.length < MIN_SESSIONS ||
        sessions.every((s) => s.state === "starting") ||
        !sessions.some((s) => s.metadata.assistantMessageCount >= 2)
      ) {
        return;
      }

      const fp = sessionFingerprint(sessions);
      if (fp === prevFingerprint) return;

      // Parse previous fingerprint into a lookup of id -> state
      const prevSessions = prevFingerprint.split("|").reduce(
        (acc, pair) => {
          const [id, st] = pair.split(":");
          if (id) acc[id] = st;
          return acc;
        },
        {} as Record<string, string>
      );

      // Check if any session just went from active -> idle (response completed)
      const hasRelevantChange = sessions.some((s) => {
        const prev = prevSessions[s.id];
        // Session just completed a response
        if (
          prev &&
          (prev === "thinking" || prev === "toolUse") &&
          s.state === "idle"
        ) {
          return true;
        }
        // New session appeared, is past startup, and has had some conversation
        if (!prev && s.state !== "starting" && s.metadata.assistantMessageCount >= 2) return true;
        return false;
      });

      // Also trigger if sessions were removed
      const sessionRemoved = Object.keys(prevSessions).some(
        (id) => !sessions.find((s) => s.id === id)
      );

      // Re-summarise drifted conversations: trigger every N assistant messages
      const hasDriftedSession = sessions.some((s) => {
        const count = s.metadata.assistantMessageCount;
        const lastAt = lastSummarisedAt[s.id] ?? 0;
        return count >= 2 && count - lastAt >= RESUMMARISE_INTERVAL;
      });

      prevFingerprint = fp;

      if (hasRelevantChange || sessionRemoved || hasDriftedSession) {
        // Record the current message counts so we don't re-trigger immediately
        for (const s of sessions) {
          if (s.metadata.assistantMessageCount >= 2) {
            lastSummarisedAt[s.id] = s.metadata.assistantMessageCount;
          }
        }
        triggerSummary();
      }
    });

    return unsub;
  }, [triggerSummary]);

  return { isRunning: isRunningRef.current };
}
