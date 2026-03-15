/**
 * Performance tracing for startup diagnostics.
 * Logs timestamped events to a global array that can be dumped to console or file.
 */

interface TraceEntry {
  ts: number;      // ms since page load
  event: string;
  durationMs?: number;
}

const traces: TraceEntry[] = [];
const t0 = performance.now();

export function trace(event: string): void {
  traces.push({ ts: Math.round(performance.now() - t0), event });
}

export function traceAsync<T>(event: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  trace(`${event} [start]`);
  return fn().then(
    (result) => {
      const dur = Math.round(performance.now() - start);
      traces.push({ ts: Math.round(performance.now() - t0), event: `${event} [done]`, durationMs: dur });
      return result;
    },
    (err) => {
      const dur = Math.round(performance.now() - start);
      traces.push({ ts: Math.round(performance.now() - t0), event: `${event} [FAIL]`, durationMs: dur });
      throw err;
    }
  );
}

export function dumpTraces(): string {
  return traces.map((t) => {
    const dur = t.durationMs ? ` (${t.durationMs}ms)` : "";
    return `+${t.ts}ms  ${t.event}${dur}`;
  }).join("\n");
}

// Dump on demand via console
(globalThis as Record<string, unknown>).__perfDump = () => {
  const dump = dumpTraces();
  console.log(dump);
  return dump;
};
