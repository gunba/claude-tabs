import { useEffect, useMemo, useRef } from "react";
import { useSessionStore } from "../../store/sessions";
import { getEffectiveState } from "../../lib/claude";
import { isSessionIdle } from "../../types/session";
import claudeMascot from "../../assets/claude-mascot.png";
import codexMascot from "../../assets/codex-mascot.png";
import "./HeaderActivityViz.css";

// [HA-01] Ambient activity scene — wave bars + per-session mascots; rAF-driven, decorative-only.

const BAR_COUNT = 56;
const MAX_ACTIVE_MASCOTS = 8;
const MAX_IDLE_MASCOTS = 6;
const MASCOT_SIZE = 16;
const SHORE_RATIO = 0.22;

const MASCOT_SRC: Record<"claude" | "codex", string> = {
  claude: claudeMascot,
  codex: codexMascot,
};

interface Slot {
  id: string;
  cli: "claude" | "codex";
  isActive: boolean;
}

export function HeaderActivityViz() {
  const containerRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<Array<HTMLDivElement | null>>(new Array(BAR_COUNT).fill(null));
  const mascotsRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const sessions = useSessionStore((s) => s.sessions);
  const subagents = useSessionStore((s) => s.subagents);

  const slots: Slot[] = useMemo(() => {
    return sessions
      .filter((s) => s.state !== "dead" && !s.isMetaAgent)
      .map((s) => {
        const eff = getEffectiveState(s.state, subagents.get(s.id) || []);
        return {
          id: s.id,
          cli: s.config.cli,
          isActive: !isSessionIdle(eff),
        };
      });
  }, [sessions, subagents]);

  const slotsRef = useRef(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  // Activity intensity, smoothed over time. 0 = quiet, 1 = saturated.
  const intensityRef = useRef(0.15);
  const lastToolCounts = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const tickActivity = () => {
      const latest = useSessionStore.getState().sessions;
      let delta = 0;
      const seen = new Set<string>();
      for (const s of latest) {
        seen.add(s.id);
        const cur = s.metadata.toolCount ?? 0;
        const prev = lastToolCounts.current.get(s.id);
        if (prev === undefined) {
          // First sighting — seed without counting historical activity.
          lastToolCounts.current.set(s.id, cur);
          continue;
        }
        if (cur > prev) delta += cur - prev;
        lastToolCounts.current.set(s.id, cur);
      }
      // Drop counters for vanished sessions.
      for (const id of [...lastToolCounts.current.keys()]) {
        if (!seen.has(id)) lastToolCounts.current.delete(id);
      }
      // Saturating map: 1 tool ≈ 0.3, 5 ≈ 0.8, 10+ ≈ 0.97.
      const burst = 1 - Math.exp(-delta / 3);
      // Slow EMA so the wave breathes rather than snaps.
      intensityRef.current = intensityRef.current * 0.7 + (0.15 + 0.85 * burst) * 0.3;
    };
    const interval = window.setInterval(tickActivity, 500);
    return () => window.clearInterval(interval);
  }, []);

  // Single rAF loop drives bars + mascots without React re-renders. The
  // browser throttles rAF on hidden tabs to ~1 Hz on its own, so no manual
  // visibility plumbing is needed.
  useEffect(() => {
    if (!containerRef.current) return;
    let rafId = 0;

    const tick = (timeMs: number) => {
      if (!containerRef.current) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const t = timeMs / 1000;
      const intensity = intensityRef.current;

      // Bars — sinusoidal pattern, amplitude scaled by intensity.
      const heights = new Array<number>(BAR_COUNT);
      for (let i = 0; i < BAR_COUNT; i++) {
        const wave = Math.sin(i * 0.42 + t * 1.7) * 0.5 + 0.5;
        const ripple = Math.sin(i * 1.31 - t * 1.05) * 0.18;
        const baseline = 0.12;
        const h = baseline + (wave + ripple) * 0.55 * intensity;
        const clamped = Math.max(0.04, Math.min(0.95, h));
        heights[i] = clamped;
        const bar = barsRef.current[i];
        if (bar) bar.style.transform = `scaleY(${clamped})`;
      }

      // Mascots — split actives onto the wave, idles onto the shore.
      const containerEl = containerRef.current;
      const w = containerEl.clientWidth;
      const h = containerEl.clientHeight;
      if (w > 0 && h > 0) {
        const actives = slotsRef.current.filter((s) => s.isActive).slice(0, MAX_ACTIVE_MASCOTS);
        const idles = slotsRef.current.filter((s) => !s.isActive).slice(0, MAX_IDLE_MASCOTS);

        const shoreEnd = w * SHORE_RATIO;
        const waveStart = shoreEnd;
        const waveWidth = Math.max(0, w - waveStart);
        const surface = h - 1; // one px above the bottom for visual rest

        actives.forEach((slot, i) => {
          const el = mascotsRef.current.get(slot.id);
          if (!el) return;
          const norm = actives.length === 1 ? 0.5 : (i + 0.5) / actives.length;
          const x = waveStart + norm * waveWidth;
          const barIdx = Math.min(BAR_COUNT - 1, Math.floor(norm * BAR_COUNT));
          const barH = heights[barIdx];
          const crest = h * (1 - barH);
          const bob = Math.sin(t * 2.3 + i * 1.4) * 1.6;
          const y = crest - MASCOT_SIZE + bob;
          el.style.transform = `translate(${x - MASCOT_SIZE / 2}px, ${y}px)`;
          el.style.opacity = "0.85";
        });

        idles.forEach((slot, i) => {
          const el = mascotsRef.current.get(slot.id);
          if (!el) return;
          const cohort = Math.max(idles.length, 3);
          const norm = (i + 0.5) / cohort;
          const x = norm * shoreEnd;
          const breath = 1.0 + Math.sin(t * 1.2 + i * 1.7) * 0.05;
          const y = surface - MASCOT_SIZE;
          el.style.transform = `translate(${x - MASCOT_SIZE / 2}px, ${y}px) scale(${breath})`;
          el.style.opacity = "0.55";
        });

        // Hide overflow mascots (more than the cap allows).
        const visibleIds = new Set<string>([...actives, ...idles].map((s) => s.id));
        mascotsRef.current.forEach((el, id) => {
          if (!visibleIds.has(id)) el.style.opacity = "0";
        });
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div ref={containerRef} className="header-activity-viz" aria-hidden="true">
      <div className="header-activity-viz-wave">
        {Array.from({ length: BAR_COUNT }).map((_, i) => (
          <div
            key={i}
            ref={(el) => {
              barsRef.current[i] = el;
            }}
            className="header-activity-viz-bar"
          />
        ))}
      </div>
      {slots.map((slot) => (
        <img
          key={slot.id}
          ref={(el) => {
            if (el) mascotsRef.current.set(slot.id, el);
            else mascotsRef.current.delete(slot.id);
          }}
          className={`header-activity-viz-mascot header-activity-viz-mascot-${slot.cli}`}
          src={MASCOT_SRC[slot.cli]}
          alt=""
          width={MASCOT_SIZE}
          height={MASCOT_SIZE}
          draggable={false}
        />
      ))}
    </div>
  );
}
