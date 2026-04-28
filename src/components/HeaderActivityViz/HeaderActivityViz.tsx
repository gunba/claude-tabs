import { useEffect, useMemo, useRef } from "react";
import { useSessionStore } from "../../store/sessions";
import { useWeatherStore } from "../../store/weather";
import { isSessionIdle, type SessionState } from "../../types/session";
import { sceneForCode, type WeatherScene } from "../../lib/weatherCodes";
import "./HeaderActivityViz.css";

// [HA-01] Single-canvas ASCII scene rendered into the dead space between the
// tab list and the right-hand action buttons. Beach sits as a fixed 8-cell band
// on the left; surfers bounce between the beach edge and the right canvas edge.
// Wave period and animation speed are measured in character cells per second so
// the visual is identical at any monitor width. All paint happens in a single
// rAF tick on one <canvas> — no per-bar refs, no per-mascot DOM nodes.

const CELL_W = 7;
const CELL_H = 12;
const FONT_PX = 11;
const BEACH_COLS = 8;
const WAVE_PERIOD_CELLS = 14;
const WAVE_SPEED_CPS = 4;
const WAVE_AMPLITUDE_ROWS = 1.3;
const BUBBLE_INTERVAL_MS = 320;
const BUBBLE_LIFE_MS = 1200;
const STORM_PERIOD_S = 7;
const STORM_FLASH_S = 0.1;

interface SlotData {
  id: string;
  cli: "claude" | "codex";
  isSubagent: boolean;
  isCompleted: boolean;
  state: SessionState;
}

interface Slot extends SlotData {
  colF: number;
  dir: 1 | -1;
  homeCol: number;
  homeRow: number;
  speed: number;
  jitterSeed: number;
  diveT: number;
  bubbleAccumMs: number;
}

interface Bubble {
  colF: number;
  rowF: number;
  ageMs: number;
}

interface Cloud {
  x: number;
  row: number;
  width: number;
  speed: number;
}

interface Flake {
  colF: number;
  rowF: number;
  swaySeed: number;
  speed: number;
}

interface ThemeProps {
  bgSurface: string;
  textMuted: string;
  textSecondary: string;
  cliClaude: string;
  cliCodex: string;
  error: string;
  fontMono: string;
}

export function hash32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function makeSlotInit(id: string) {
  const h = hash32(id);
  const r1 = (h % 1000) / 1000;
  const r2 = ((h >> 10) % 1000) / 1000;
  const r3 = ((h >> 20) % 1000) / 1000;
  return {
    homeCol: 1 + r1 * (BEACH_COLS - 2),
    homeRow: r2,
    speed: 5 + r3 * 4,
    jitterSeed: r1 * Math.PI * 2,
  };
}

function readThemeProps(): ThemeProps {
  const css = getComputedStyle(document.documentElement);
  const get = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback;
  return {
    bgSurface: get("--bg-surface", "#1a1a1a"),
    textMuted: get("--text-muted", "#888888"),
    textSecondary: get("--text-secondary", "#aaaaaa"),
    cliClaude: get("--cli-claude", "#d4744a"),
    cliCodex: get("--cli-codex", "#39c5cf"),
    error: get("--error", "#d96666"),
    fontMono: get("--font-mono", "monospace"),
  };
}

export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith("#") && (c.length === 7 || c.length === 4)) {
    let r: number;
    let g: number;
    let b: number;
    if (c.length === 7) {
      r = parseInt(c.slice(1, 3), 16);
      g = parseInt(c.slice(3, 5), 16);
      b = parseInt(c.slice(5, 7), 16);
    } else {
      r = parseInt(c[1] + c[1], 16);
      g = parseInt(c[2] + c[2], 16);
      b = parseInt(c[3] + c[3], 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
  return c;
}

export const BEACH_GLYPHS = [
  { ch: ".", light: true },
  { ch: ",", light: true },
  { ch: ":", light: false },
  { ch: ";", light: false },
  { ch: "'", light: true },
] as const;

export function beachGlyph(col: number, row: number) {
  return BEACH_GLYPHS[(col * 31 + row * 7) % BEACH_GLYPHS.length];
}

export function clampCol(colF: number, cols: number): number {
  const c = Math.floor(colF);
  if (c < 0) return 0;
  if (c >= cols) return cols - 1;
  return c;
}

export function HeaderActivityViz() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slotsMapRef = useRef<Map<string, Slot>>(new Map());
  const bubblesRef = useRef<Bubble[]>([]);
  const cloudsRef = useRef<Cloud[] | null>(null);
  const flakesRef = useRef<Flake[] | null>(null);
  const intensityRef = useRef(0.15);
  const themeRef = useRef<ThemeProps | null>(null);
  const sceneRef = useRef<WeatherScene>("clear");

  const sessions = useSessionStore((s) => s.sessions);
  const subagents = useSessionStore((s) => s.subagents);
  const weatherCode = useWeatherStore((s) => s.weatherCode);

  const slots = useMemo<SlotData[]>(() => {
    const out: SlotData[] = [];
    for (const s of sessions) {
      if (s.state === "dead" || s.isMetaAgent) continue;
      out.push({
        id: s.id,
        cli: s.config.cli,
        isSubagent: false,
        isCompleted: false,
        state: s.state,
      });
      const subs = subagents.get(s.id) || [];
      for (const sub of subs) {
        if (sub.state === "dead") continue;
        if (isSessionIdle(sub.state) && !sub.completed) continue;
        out.push({
          id: `${s.id}::${sub.id}`,
          cli: s.config.cli,
          isSubagent: true,
          isCompleted: !!sub.completed,
          state: sub.state,
        });
      }
    }
    return out;
  }, [sessions, subagents]);

  useEffect(() => {
    sceneRef.current = sceneForCode(weatherCode);
    cloudsRef.current = null;
    flakesRef.current = null;
  }, [weatherCode]);

  useEffect(() => {
    const map = slotsMapRef.current;
    const seen = new Set<string>();
    for (const s of slots) {
      seen.add(s.id);
      const existing = map.get(s.id);
      if (existing) {
        existing.cli = s.cli;
        existing.isSubagent = s.isSubagent;
        existing.isCompleted = s.isCompleted;
        existing.state = s.state;
      } else {
        const init = makeSlotInit(s.id);
        map.set(s.id, {
          ...s,
          colF: init.homeCol,
          dir: 1,
          homeCol: init.homeCol,
          homeRow: init.homeRow,
          speed: init.speed,
          jitterSeed: init.jitterSeed,
          diveT: 0,
          bubbleAccumMs: 0,
        });
      }
    }
    for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
  }, [slots]);

  useEffect(() => {
    const lastCounts = new Map<string, number>();
    const tick = () => {
      const latest = useSessionStore.getState().sessions;
      let delta = 0;
      const present = new Set<string>();
      for (const s of latest) {
        present.add(s.id);
        const cur = s.metadata.toolCount ?? 0;
        const prev = lastCounts.get(s.id);
        if (prev === undefined) {
          lastCounts.set(s.id, cur);
          continue;
        }
        if (cur > prev) delta += cur - prev;
        lastCounts.set(s.id, cur);
      }
      for (const id of [...lastCounts.keys()]) if (!present.has(id)) lastCounts.delete(id);
      const burst = 1 - Math.exp(-delta / 3);
      intensityRef.current = intensityRef.current * 0.7 + (0.15 + 0.85 * burst) * 0.3;
    };
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  const themeBumpRef = useRef(0);
  useEffect(() => {
    themeRef.current = readThemeProps();
    themeBumpRef.current++;
    const obs = new MutationObserver(() => {
      themeRef.current = readThemeProps();
      themeBumpRef.current++;
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let prevMs = 0;
    let prevDpr = 0;
    let prevW = 0;
    let prevH = 0;
    let needsResize = true;
    let lastThemeBump = -1;

    const ro = new ResizeObserver(() => {
      needsResize = true;
    });
    ro.observe(wrapper);

    let prevFont = "";
    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(0, Math.floor(rect.width));
      const h = Math.max(0, Math.floor(rect.height));
      const sizeChanged = w !== prevW || h !== prevH || dpr !== prevDpr;
      if (sizeChanged) {
        prevW = w;
        prevH = h;
        prevDpr = dpr;
        canvas.width = Math.max(1, w * dpr);
        canvas.height = Math.max(1, h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const fontMono = themeRef.current?.fontMono ?? "monospace";
      const desired = `${FONT_PX}px ${fontMono}`;
      if (sizeChanged || desired !== prevFont) {
        ctx.font = desired;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        prevFont = desired;
      }
    };

    const render = (timeMs: number) => {
      if (themeBumpRef.current !== lastThemeBump) {
        lastThemeBump = themeBumpRef.current;
        needsResize = true;
      }
      if (needsResize) {
        resize();
        needsResize = false;
      }
      const w = prevW;
      const h = prevH;
      const theme = themeRef.current;
      if (w <= 0 || h <= 0 || !theme) {
        rafId = requestAnimationFrame(render);
        return;
      }
      const cols = Math.floor(w / CELL_W);
      const rows = Math.floor(h / CELL_H);

      ctx.fillStyle = theme.bgSurface;
      ctx.fillRect(0, 0, w, h);

      if (cols < BEACH_COLS + 4 || rows < 4) {
        rafId = requestAnimationFrame(render);
        return;
      }

      const dt = prevMs === 0 ? 16 : Math.min(64, timeMs - prevMs);
      const dtSec = dt / 1000;
      prevMs = timeMs;
      const t = timeMs / 1000;
      const intensity = intensityRef.current;
      const scene = sceneRef.current;
      const baselineRow = rows - 2;
      const beachTopRow = baselineRow - 1;

      const waveCrest = new Float32Array(cols);
      for (let c = 0; c < cols; c++) {
        const phase = (c / WAVE_PERIOD_CELLS - (t * WAVE_SPEED_CPS) / WAVE_PERIOD_CELLS) * Math.PI * 2;
        waveCrest[c] = baselineRow - Math.sin(phase) * WAVE_AMPLITUDE_ROWS * intensity;
      }

      drawSky(ctx, scene, t, dtSec, cols, rows, baselineRow, theme, cloudsRef, flakesRef);

      // Beach
      for (let row = beachTopRow; row < rows; row++) {
        for (let col = 0; col < BEACH_COLS; col++) {
          const g = beachGlyph(col, row);
          ctx.fillStyle = g.light ? "#c8a868" : "#a07c44";
          ctx.fillText(g.ch, col * CELL_W, row * CELL_H);
        }
      }

      // Wave: crest with `^`/`~` + one row of body `~` below.
      for (let c = BEACH_COLS; c < cols; c++) {
        const crest = waveCrest[c];
        const crestRow = Math.max(0, Math.floor(crest));
        const left = c > 0 ? waveCrest[c - 1] : crest;
        const right = c < cols - 1 ? waveCrest[c + 1] : crest;
        const isPeak = crest <= left && crest <= right;
        if (crestRow < rows) {
          ctx.fillStyle = withAlpha(theme.textSecondary, isPeak ? 0.85 : 0.6);
          ctx.fillText(isPeak ? "^" : "~", c * CELL_W, crestRow * CELL_H);
        }
        ctx.fillStyle = withAlpha(theme.textMuted, 0.5);
        for (let row = crestRow + 1; row < rows; row++) {
          ctx.fillText("~", c * CELL_W, row * CELL_H);
        }
      }

      // Slots: update + draw
      for (const slot of slotsMapRef.current.values()) {
        updateSlot(slot, dtSec, t, cols, waveCrest, bubblesRef);

        const isErrored = slot.state === "error" || slot.state === "interrupted";
        const isIdle = !isErrored && isSessionIdle(slot.state);
        const isActive = !isErrored && !isIdle;

        let glyph: string;
        let baseColor: string;
        let alpha: number;
        if (isErrored) {
          glyph = "x";
          baseColor = theme.error;
          alpha = 0.9 - slot.diveT * 0.7;
        } else {
          baseColor = slot.cli === "claude" ? theme.cliClaude : theme.cliCodex;
          if (slot.isSubagent) glyph = "o";
          else glyph = slot.cli === "claude" ? "&" : "@";
          if (isActive) {
            alpha = slot.isSubagent ? 0.7 : 0.9;
          } else {
            alpha = slot.isSubagent ? 0.45 : 0.6;
            if (slot.isCompleted) alpha *= 0.7;
          }
        }
        if (alpha <= 0) continue;

        let displayRow: number;
        if (isErrored) {
          const c = clampCol(slot.colF, cols);
          displayRow = Math.floor(waveCrest[c]) + Math.floor(slot.diveT * 2);
        } else if (isActive) {
          const c = clampCol(slot.colF, cols);
          displayRow = Math.floor(waveCrest[c]) - 1;
        } else {
          displayRow = beachTopRow + Math.round(slot.homeRow);
        }
        const dispCol = Math.floor(slot.colF);
        if (dispCol < 0 || dispCol >= cols || displayRow < 0 || displayRow >= rows) continue;
        ctx.fillStyle = withAlpha(baseColor, Math.max(0, alpha));
        ctx.fillText(glyph, dispCol * CELL_W, displayRow * CELL_H);
      }

      // Sun (drawn after the wave so the wave can't overpaint it).
      if (scene === "clear") {
        drawSun(ctx, cols, t);
      }

      // Bubbles
      const bub = bubblesRef.current;
      for (let i = bub.length - 1; i >= 0; i--) {
        const b = bub[i];
        b.ageMs += dt;
        b.rowF -= dtSec * 2.0;
        if (b.ageMs > BUBBLE_LIFE_MS || b.rowF < -1) {
          bub.splice(i, 1);
          continue;
        }
        const a = 0.7 * (1 - b.ageMs / BUBBLE_LIFE_MS);
        const c = Math.floor(b.colF);
        const r = Math.floor(b.rowF);
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
        ctx.fillText("°", c * CELL_W, r * CELL_H);
      }

      // Storm flash overlay (after everything)
      if (scene === "storm") {
        const phase = t % STORM_PERIOD_S;
        if (phase < STORM_FLASH_S) {
          const a = 0.18 * (1 - phase / STORM_FLASH_S);
          ctx.fillStyle = `rgba(220, 230, 255, ${a.toFixed(3)})`;
          ctx.fillRect(0, 0, w, h);
        }
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="header-activity-viz" aria-hidden="true">
      <canvas ref={canvasRef} className="header-activity-viz-canvas" />
    </div>
  );
}

function updateSlot(
  slot: Slot,
  dtSec: number,
  t: number,
  cols: number,
  waveCrest: Float32Array,
  bubblesRef: { current: Bubble[] },
) {
  const isErrored = slot.state === "error" || slot.state === "interrupted";
  const isIdle = !isErrored && isSessionIdle(slot.state);
  const isActive = !isErrored && !isIdle;

  const targetDive = isErrored ? 1 : 0;
  slot.diveT += (targetDive - slot.diveT) * 0.06;
  if (slot.diveT < 0.001) slot.diveT = 0;

  if (isActive) {
    if (slot.colF < BEACH_COLS) {
      slot.colF = BEACH_COLS;
      slot.dir = 1;
    }
    slot.colF += slot.dir * slot.speed * dtSec;
    if (slot.dir > 0 && slot.colF >= cols - 1) {
      slot.colF = cols - 1;
      slot.dir = -1;
    } else if (slot.dir < 0 && slot.colF <= BEACH_COLS) {
      slot.colF = BEACH_COLS;
      slot.dir = 1;
    }
  } else if (isIdle) {
    slot.colF += (slot.homeCol - slot.colF) * 0.06;
  } else {
    slot.bubbleAccumMs += dtSec * 1000;
    if (slot.diveT > 0.4 && slot.bubbleAccumMs >= BUBBLE_INTERVAL_MS) {
      slot.bubbleAccumMs = 0;
      const c = clampCol(slot.colF, cols);
      const agentRow = Math.floor(waveCrest[c]) + Math.floor(slot.diveT * 2);
      bubblesRef.current.push({
        colF: slot.colF + Math.sin(t * 5 + slot.jitterSeed) * 0.3,
        rowF: agentRow - 1,
        ageMs: 0,
      });
    }
  }
}

function drawSky(
  ctx: CanvasRenderingContext2D,
  scene: WeatherScene,
  t: number,
  dtSec: number,
  cols: number,
  rows: number,
  baselineRow: number,
  theme: ThemeProps,
  cloudsRef: { current: Cloud[] | null },
  flakesRef: { current: Flake[] | null },
) {
  switch (scene) {
    case "clear":
      // Sun is drawn by the main render after the wave so the wave can't paint
      // over its rays at high intensity.
      break;
    case "clouds":
      drawClouds(ctx, cols, rows, dtSec, cloudsRef);
      break;
    case "rain":
      drawRain(ctx, cols, baselineRow, t);
      break;
    case "snow":
      drawSnow(ctx, cols, baselineRow, t, dtSec, flakesRef);
      break;
    case "storm":
      drawRain(ctx, cols, baselineRow, t);
      break;
    case "fog":
      drawFog(ctx, cols, baselineRow, theme);
      break;
  }
}

function drawSun(ctx: CanvasRenderingContext2D, cols: number, t: number) {
  const ax = cols - 4;
  const ay = 0;
  const pulse = 0.85 + 0.15 * (0.5 + 0.5 * Math.sin(t * 1.2));
  const rayAlpha = 0.85;
  const sunHex = "#f3c34a";
  ctx.fillStyle = withAlpha(sunHex, rayAlpha);
  ctx.fillText("\\", ax * CELL_W, ay * CELL_H);
  ctx.fillText("|", (ax + 1) * CELL_W, ay * CELL_H);
  ctx.fillText("/", (ax + 2) * CELL_W, ay * CELL_H);
  ctx.fillText("-", ax * CELL_W, (ay + 1) * CELL_H);
  ctx.fillStyle = withAlpha(sunHex, pulse);
  ctx.fillText("O", (ax + 1) * CELL_W, (ay + 1) * CELL_H);
  ctx.fillStyle = withAlpha(sunHex, rayAlpha);
  ctx.fillText("-", (ax + 2) * CELL_W, (ay + 1) * CELL_H);
  ctx.fillText("/", ax * CELL_W, (ay + 2) * CELL_H);
  ctx.fillText("|", (ax + 1) * CELL_W, (ay + 2) * CELL_H);
  ctx.fillText("\\", (ax + 2) * CELL_W, (ay + 2) * CELL_H);
}

function drawClouds(
  ctx: CanvasRenderingContext2D,
  cols: number,
  rows: number,
  dtSec: number,
  cloudsRef: { current: Cloud[] | null },
) {
  if (!cloudsRef.current) {
    cloudsRef.current = [
      { x: cols * 0.1, row: 0, width: 4, speed: 1.8 },
      { x: cols * 0.45, row: 1, width: 5, speed: 2.4 },
      { x: cols * 0.75, row: 0, width: 3, speed: 1.4 },
    ];
  }
  ctx.fillStyle = "rgba(180, 180, 195, 0.55)";
  for (const cloud of cloudsRef.current) {
    cloud.x += cloud.speed * dtSec;
    if (cloud.x > cols + cloud.width + 2) cloud.x = -cloud.width - 1;
    if (cloud.row >= rows) continue;
    for (let i = 0; i < cloud.width; i++) {
      const c = Math.floor(cloud.x) + i;
      if (c < 0 || c >= cols) continue;
      ctx.fillText("_", c * CELL_W, cloud.row * CELL_H);
    }
  }
}

function drawRain(ctx: CanvasRenderingContext2D, cols: number, baselineRow: number, t: number) {
  ctx.fillStyle = "rgba(155, 194, 230, 0.7)";
  // Each column has a single drop with a deterministic phase. We compute its y
  // every frame from t — no per-column state needed.
  for (let c = 0; c < cols; c++) {
    const phase = ((c * 0.37 + t * 1.4) % 1 + 1) % 1;
    const dropY = phase * (baselineRow + 1);
    const r = Math.floor(dropY);
    if (r < 0 || r > baselineRow) continue;
    const slant = Math.floor(r * 0.2);
    const col = c + slant;
    if (col < 0 || col >= cols) continue;
    ctx.fillText("'", col * CELL_W, r * CELL_H);
  }
}

function drawSnow(
  ctx: CanvasRenderingContext2D,
  cols: number,
  baselineRow: number,
  t: number,
  dtSec: number,
  flakesRef: { current: Flake[] | null },
) {
  if (!flakesRef.current) {
    const flakes: Flake[] = [];
    const count = Math.min(14, Math.max(6, Math.floor(cols / 8)));
    for (let i = 0; i < count; i++) {
      flakes.push({
        colF: (i / count) * cols,
        rowF: (i % 5) - 1,
        swaySeed: i * 1.7,
        speed: 1.2 + (i % 5) * 0.15,
      });
    }
    flakesRef.current = flakes;
  }
  ctx.fillStyle = "rgba(232, 238, 248, 0.85)";
  for (const f of flakesRef.current) {
    f.rowF += f.speed * dtSec;
    const sway = Math.sin(t * 0.7 + f.swaySeed);
    const dispCol = Math.floor(f.colF + sway);
    if (f.rowF > baselineRow) {
      f.rowF = -1;
      f.colF = (f.colF + 7.3) % cols;
    }
    if (dispCol < 0 || dispCol >= cols) continue;
    const r = Math.floor(f.rowF);
    if (r < 0 || r > baselineRow) continue;
    const ch = (Math.floor(f.swaySeed * 10) & 1) === 0 ? "*" : ".";
    ctx.fillText(ch, dispCol * CELL_W, r * CELL_H);
  }
}

function drawFog(ctx: CanvasRenderingContext2D, cols: number, baselineRow: number, theme: ThemeProps) {
  ctx.fillStyle = withAlpha(theme.textMuted, 0.3);
  for (let row = Math.max(0, baselineRow - 2); row < baselineRow; row++) {
    const offset = row % 2;
    for (let c = offset; c < cols; c += 2) {
      ctx.fillText("~", c * CELL_W, row * CELL_H);
    }
  }
}
