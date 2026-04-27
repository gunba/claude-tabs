---
paths:
  - "src/components/ActivityPanel/ActivityPanel.tsx"
---

# src/components/ActivityPanel/ActivityPanel.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Activity Panel

- [AP-04 L17] ActivityPanel shows a floating/sticky mascot that travels to the file currently being accessed by the main agent. The mascot is provider-aware (cli prop drives MASCOT_SRC: claude-mascot.png or codex-mascot.png — pre-rename agent-mascot.png is gone). Animations: reading (rocking), writing (rocking), moving (hop on path change), idle (subtle bob). Mascot animation is suppressed on tab switch: StickyMascot carries a tabId, and the floating mascot div is only rendered when mascot.tabId === activeTabId. On tab switch the stale mascot unmounts, preventing the CSS transition from animating the jump between tabs; the effect re-runs on activeTabId change and mounts a fresh mascot at the new tab's position. Mascot persists within a session across idle periods. Subagent files show inline indicators at their last-touched files while active, and completed subagents remain dimmed at their last-touched files. Subagent indicators render <AgentTypeIcon> (Compass / Clipboard / Sparkles / BookOpen / Terminal / ShieldCheck / Bot fallback) inside the same .agent-mascot-img wrapper so the rock/hop/bob animations and overlay emoji apply identically; only main-agent indicators use the provider mascot artwork. .agent-mascot-icon tints the SVG with var(--cli-claude). Tree indentation uses INDENT_STEP=16px.
- [AP-05 L18] ActivityPanel has two view modes toggled by a button group: 'Response' (files touched since lastUserMessageAt, filtered per-file by timestamp) and 'Session' (all visited paths via allFiles/visitedPaths). File state communicated through filename color only: created=green (--success), modified=yellow (--warning), deleted=red+strikethrough (--error), read=muted (--text-secondary) via file-tree-kind-* CSS classes. No letter badges.
- [AP-06 L141] Searched-color agent precedence: (1) Write-side in addFileActivity() — turn-dedup branch (src/store/activity.ts:L183) and allFiles branch (activity.ts:L213) both skip a subagent searched entry when a main-agent (agentId=null) entry already exists for the same path. (2) Render-side in ActivityPanel.tsx:L134 — file-tree-searched CSS applied to a folder only when node.activity.kind==='searched' AND (agentId is null/undefined — main agent always wins — OR agentId is still in the active subagent set). When a subagent is removed via removeSubagent(), clearAgentSearchActivity() drops all {kind:'searched',isFolder:true,agentId:X} entries from turns and allFiles. Both layers ensure subagent searches never override or outlive main-agent search coloring.
