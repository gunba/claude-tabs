import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { trace, traceAsync } from "../lib/perfTrace";
import { assignSessionColor, releaseSessionColor } from "../lib/claude";
import type {
  Session,
  SessionConfig,
  SessionState,
  SessionMetadata,
  Subagent,
} from "../types/session";

interface SessionsState {
  sessions: Session[];
  activeTabId: string | null;
  claudePath: string | null;
  initialized: boolean;
  subagents: Map<string, Subagent[]>; // sessionId -> subagents
  respawnRequest: { tabId: string; config: SessionConfig; name?: string } | null;

  // Actions
  init: () => Promise<void>;
  createSession: (name: string, config: SessionConfig, opts?: { isMetaAgent?: boolean; insertAtIndex?: number }) => Promise<Session>;
  closeSession: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  updateState: (id: string, state: SessionState) => void;
  updateMetadata: (id: string, metadata: Partial<SessionMetadata>) => void;
  updateConfig: (id: string, config: Partial<SessionConfig>) => void;
  reorderTabs: (order: string[]) => void;
  persist: () => Promise<void>;
  renameSession: (id: string, name: string) => void;
  requestRespawn: (tabId: string, config: SessionConfig, name?: string) => void;
  clearRespawnRequest: () => void;
  addSubagent: (sessionId: string, subagent: Subagent) => void;
  updateSubagent: (sessionId: string, subagentId: string, updates: Partial<Subagent>) => void;
}

export const useSessionStore = create<SessionsState>((set) => ({
  sessions: [],
  activeTabId: null,
  claudePath: null,
  initialized: false,
  subagents: new Map(),
  respawnRequest: null,

  init: async () => {
    trace("init: start");
    try {
      const sessions = await traceAsync("init: load_persisted_sessions", () =>
        invoke<Session[]>("load_persisted_sessions")
      );
      // Assign colors sequentially to restored sessions
      const allIds = sessions.map((s) => s.id);
      for (const s of sessions) {
        assignSessionColor(s.id, allIds);
      }
      set({ sessions, activeTabId: null, initialized: true });
      trace("init: sessions set, initialized=true");
    } catch {
      set({ initialized: true });
      trace("init: no sessions, initialized=true");
    }
    // Detect CLI path in background
    traceAsync("init: detect_claude_cli", () => invoke<string>("detect_claude_cli"))
      .then((claudePath) => { set({ claudePath }); trace("init: claudePath set"); })
      .catch((e) => console.error("CLI detection failed:", e));
  },

  createSession: async (name, config, opts = {}) => {
    const session = await invoke<Session>("create_session", { name, config });
    const tagged = {
      ...session,
      isMetaAgent: opts.isMetaAgent ?? false,
    };
    // Assign a color to the new session, avoiding colors of existing sessions
    const existingIds = useSessionStore.getState().sessions.map((s) => s.id);
    assignSessionColor(tagged.id, existingIds);
    set((s) => {
      let sessions;
      if (opts.insertAtIndex !== undefined && opts.insertAtIndex >= 0) {
        // Revival: insert at the original position to preserve ordering
        sessions = [...s.sessions];
        sessions.splice(opts.insertAtIndex, 0, tagged);
      } else if (opts.isMetaAgent) {
        sessions = [tagged, ...s.sessions];
      } else {
        sessions = [...s.sessions, tagged];
      }
      return { sessions, activeTabId: tagged.id };
    });
    return tagged;
  },

  closeSession: async (id) => {
    await invoke("close_session", { id });
    releaseSessionColor(id);
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id);
      const activeTabId =
        s.activeTabId === id
          ? sessions[sessions.length - 1]?.id ?? null
          : s.activeTabId;
      const subagents = new Map(s.subagents);
      subagents.delete(id);
      return { sessions, activeTabId, subagents };
    });
    // Persist immediately so the removal is captured even if the app closes
    useSessionStore.getState().persist();
  },

  setActiveTab: (id) => {
    invoke("set_active_tab", { id });
    set({ activeTabId: id });
  },

  updateState: (id, state) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, state } : x
      ),
    }));
  },

  updateMetadata: (id, metadata) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, metadata: { ...x.metadata, ...metadata } } : x
      ),
    }));
  },

  updateConfig: (id, config) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, config: { ...x.config, ...config } } : x
      ),
    }));
  },

  reorderTabs: (order) => {
    invoke("reorder_tabs", { order });
    set((s) => {
      const map = new Map(s.sessions.map((x) => [x.id, x]));
      const sessions = order.map((id) => map.get(id)!).filter(Boolean);
      return { sessions };
    });
  },

  persist: async () => {
    // Serialize from the frontend store (not the Rust session manager)
    // because the Rust side doesn't receive metadata updates.
    // All sessions are persisted as "dead" — on reload, they can't have
    // running PTYs, so active states (thinking/toolUse) would be stale.
    const snapshots = useSessionStore.getState().sessions.map((s) => ({
      id: s.id,
      name: s.name,
      config: s.config,
      state: "dead" as const,
      metadata: s.metadata,
      createdAt: s.createdAt,
      lastActive: s.lastActive,
    }));
    await invoke("persist_sessions_json", {
      json: JSON.stringify(snapshots, null, 2),
    });
  },

  renameSession: (id, name) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, name } : x
      ),
    }));
  },

  requestRespawn: (tabId, config, name) => {
    set({ respawnRequest: { tabId, config, name } });
  },

  clearRespawnRequest: () => {
    set({ respawnRequest: null });
  },

  addSubagent: (sessionId, subagent) => {
    set((s) => {
      const map = new Map(s.subagents);
      const existing = map.get(sessionId) || [];
      // Don't add duplicates
      if (existing.some((sa) => sa.id === subagent.id)) return s;
      map.set(sessionId, [...existing, subagent]);
      return { subagents: map };
    });
  },

  updateSubagent: (sessionId, subagentId, updates) => {
    set((s) => {
      const map = new Map(s.subagents);
      const list = map.get(sessionId);
      if (!list) return s;
      const updated = list.map((sa) =>
        sa.id === subagentId ? { ...sa, ...updates } : sa
      );
      map.set(sessionId, updated);
      return { subagents: map };
    });
  },
}));
