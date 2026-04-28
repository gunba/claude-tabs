---
paths:
  - "src/components/HeaderActivityViz/HeaderActivityViz.tsx"
---

# src/components/HeaderActivityViz/HeaderActivityViz.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Header Activity Visualizer
Ambient soundwave-and-mascots scene that fills the gap between the tab strip and the right-side action buttons

- [HA-01 L15] HeaderActivityViz fills the slack between .tab-bar-scroll and the right-side buttons (.tab-resume / .tab-config / .tab-add) with a decorative ambient scene. Three layers: (1) wave — 56 absolutely-positioned bars at ~16% alpha of var(--text-muted), heights animated via 'transform: scaleY(...)' on direct DOM refs in a single rAF loop; bar height = baseline 0.12 + (sin(i*0.42 + t*1.7) + sin(i*1.31 - t*1.05)*0.18) * 0.55 * intensity, clamped to 0.04..0.95. (2) Active session mascots — claude-mascot.png / codex-mascot.png positioned along the wave (waveStart = 22% of width, evenly spaced over the remaining 78%), bobbing with sin(t*2.3 + i*1.4)*1.6 px on top of the local crest, opacity 0.85, capped at 8 visible. (3) Idle session mascots — same artwork resting on the left 22% 'shore' baseline with a breathing scale 1.0±0.05 sin animation, opacity 0.55, capped at 6 visible. Overflow mascots get opacity 0. Activity intensity drives wave amplitude: every 500ms the component samples session.metadata.toolCount deltas across all sessions, maps via burst = 1 - exp(-delta/3), and runs an EMA (intensityRef.current * 0.7 + (0.15 + 0.85 * burst) * 0.3) so the wave breathes rather than snaps. lastToolCounts seeds new sessions with their current count so historical activity isn't replayed as a burst. slotsRef gives the rAF loop a stable handle on the React-derived slot list so store updates don't restart the loop. The wave / mascot updates use no React per-frame re-renders; only the slot list (one <img> per session) re-renders when sessions are added or removed. Layout: .tab-bar-scroll switched from flex:1 to flex:0 1 auto so HeaderActivityViz at flex:1 1 0 claims the leftover gap; with many overflowing tabs the visualizer collapses to 0 width while .tab-bar-scroll's overflow-x:auto handles horizontal scrolling. Component is aria-hidden, pointer-events:none — pure decoration, no interaction surface, no info display. Browser-native rAF throttling on hidden tabs covers the visibility case (no manual visibilitychange plumbing).
