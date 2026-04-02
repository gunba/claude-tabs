---
paths:
  - "src/components/Terminal/**"
  - "src/components/SearchPanel/**"
  - "src/components/SubagentInspector/**"
  - "src/App.tsx"
  - "src/App.css"
---

# Terminal UI

<!-- Codes: TR=Terminal -->

- [TR-05] Hidden tabs use CSS display: none -- never unmount/remount xterm.js (destroys state).
  - Files: src/components/Terminal/TerminalPanel.tsx
- [TR-11] Subagent card shows selected highlight (accent-secondary box-shadow + tinted background) when its inspector is open.
  - Files: src/App.tsx, src/App.css
- [TR-12] Tool blocks in SubagentInspector are collapsible: collapsed by default with tool name + one-line preview, click to expand. Last tool block auto-expands while subagent is active.
  - Files: src/components/SubagentInspector/SubagentInspector.tsx, src/components/SubagentInspector/SubagentInspector.css
- [TR-13] Context clear detection: terminal scrollback auto-clears when Claude session ID changes (/clear, plan approval, compaction). Signal-based via inspector tap events -- no input parsing or timers.
  - Files: src/components/Terminal/TerminalPanel.tsx
- [TR-16] Cross-session terminal search panel (Ctrl+Shift+F): SearchPanel searches all active session terminal buffers with debounced queries (250ms). Case-sensitive and regex modes. Results grouped by session; clicking a result switches tab and scrolls to match via SearchAddon. Capped at 500 results. searchBuffers.ts provides pure search logic; terminalRegistry.ts manages SearchAddon + scrollToLine registration.
  - Files: src/components/SearchPanel/SearchPanel.tsx, src/components/SearchPanel/SearchPanel.css, src/lib/searchBuffers.ts, src/lib/terminalRegistry.ts

- [TA-01] Tab activity display: getActivityText() passes through currentToolName for real-time tool activity. TOOL_COLORS map and toolCategoryColor() provide category-based coloring (search=#4ec9b0, file ops=#569cd6, execution=#ce9178, agent=#c586c0). Color applied via inline style; unknown/MCP tools fall back to --text-muted. App.tsx renders .tab-activity span replacing the old .tab-summary.
  - Files: src/lib/claude.ts, src/App.tsx, src/App.css

- [TA-02] Global tool name tracking: seenToolNames Set in sessions store collects unique tool names across all sessions via addSeenToolName() action. Fed by ToolCallStart events in useTapEventProcessor. Immutable Set pattern for reactivity (early return when name already present).
  - Files: src/store/sessions.ts, src/hooks/useTapEventProcessor.ts

- [TA-03] .tab-activity CSS: single-line (white-space: nowrap, text-overflow: ellipsis), 10px font, font-weight 500, no clamp. Replaces old .tab-summary (2-line clamp, 9px). Saves ~10px vertical space, fixing meta label overflow at 66px tab height.
  - Files: src/App.css
- [TA-04] ContextViewer modal ('Context' StatusBar button, no keyboard shortcut): shows captured system prompt blocks with cache boundary marker (last block with cacheControl). Displays block count, total char count, and contextDebug token stats. Falls back to single-block view when capturedSystemBlocks unavailable. Opens via onOpenContextViewer prop on StatusBar; state managed in App.tsx. Dismissed via Escape (in KB-09 chain between sidePanel and configManager).
  - Files: src/components/ContextViewer/ContextViewer.tsx, src/components/ContextViewer/ContextViewer.css, src/App.tsx, src/components/StatusBar/StatusBar.tsx
