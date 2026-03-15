import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useSessionStore } from "../../store/sessions";
import { dirToTabName } from "../../lib/claude";
import "./ActivityFeed.css";

interface FeedEntry {
  id: string;
  timestamp: number;
  sessionName: string;
  type: "output" | "summary" | "name" | "system";
  message: string;
}

const MAX_ENTRIES = 300;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface PrevSession {
  state: string;
  summary: string | null;
  name: string;
  recentOutput: string;
  muteUntil: number; // Suppress output entries until this timestamp (JSONL replay grace period)
}

export function ActivityFeed() {
  const sessions = useSessionStore((s) => s.sessions);
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<Map<string, PrevSession>>(new Map());

  const addEntry = useCallback((entry: Omit<FeedEntry, "id">) => {
    setEntries((prev) => {
      const next = [...prev, { ...entry, id: `${entry.timestamp}-${Math.random()}` }];
      return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
    });
  }, []);

  // Track session changes and generate feed entries
  useEffect(() => {
    const prev = prevRef.current;
    const now = Date.now();

    for (const session of sessions) {
      if (session.isMetaAgent) continue;

      const sessionName = session.name || dirToTabName(session.config.workingDir);
      const existing = prev.get(session.id);

      if (!existing) {
        // Initialize with CURRENT values so restored/revived state doesn't
        // generate spurious feed entries. Mute output for 5s to let JSONL replay settle.
        prev.set(session.id, {
          state: session.state,
          summary: session.metadata.nodeSummary ?? null,
          name: sessionName,
          recentOutput: session.metadata.recentOutput ?? "",
          muteUntil: now + 5000,
        });
        continue;
      }

      // Agent output — what they're "typing" (speech bubble replacement)
      const currentOutput = session.metadata.recentOutput ?? "";
      if (currentOutput && currentOutput !== existing.recentOutput && session.state !== "dead") {
        // Only show in feed after the JSONL replay grace period
        if (now >= existing.muteUntil) {
          const lines = currentOutput.split("\n").filter((l) => l.trim());
          const lastLine = lines[lines.length - 1]?.trim().slice(0, 200);
          if (lastLine) {
            addEntry({ timestamp: now, sessionName, type: "output", message: lastLine });
          }
        }
        // Always track the latest value (even during mute) so we don't
        // flood when the mute expires
        existing.recentOutput = currentOutput;
      }

      // Track state (for internal use) but don't spam the feed with transitions
      existing.state = session.state;

      // Summary update (from Haiku) — suppress during mute window (revival/restore)
      const currentSummary = session.metadata.nodeSummary ?? null;
      if (currentSummary && currentSummary !== existing.summary) {
        if (now >= existing.muteUntil) {
          addEntry({ timestamp: now, sessionName, type: "summary", message: currentSummary });
        }
        existing.summary = currentSummary;
      }

      // Name change
      if (sessionName !== existing.name) {
        addEntry({ timestamp: now, sessionName, type: "name", message: `Renamed → ${sessionName}` });
        existing.name = sessionName;
      }
    }

    // Detect removed sessions
    for (const [id, data] of prev.entries()) {
      if (!sessions.find((s) => s.id === id)) {
        addEntry({ timestamp: now, sessionName: data.name, type: "system", message: "Session closed" });
        prev.delete(id);
      }
    }
  }, [sessions, addEntry]);

  // Auto-scroll on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div className="activity-feed">
      <div className="activity-feed-header">
        <span className="activity-feed-title">Activity</span>
        <span className="activity-feed-count">{entries.length}</span>
      </div>
      <div className="activity-feed-messages" ref={scrollRef}>
        {entries.length === 0 ? (
          <div className="activity-feed-empty">No activity yet</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`feed-entry feed-entry-${entry.type}`}>
              <span className="feed-time">{formatTime(entry.timestamp)}</span>
              <span className="feed-nick">{entry.sessionName}</span>
              <span className="feed-msg"><ReactMarkdown>{entry.message}</ReactMarkdown></span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
