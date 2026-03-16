import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { getXtermTheme } from "../lib/theme";

// DEC private mode 2026 — synchronized output sequences.
// Ink (Claude Code's TUI framework) wraps redraws in these sequences.
// xterm.js 5.x doesn't support them natively (added in 6.0), so we
// intercept them here and buffer all data between start/end.
const SYNC_START = Uint8Array.from([0x1b, 0x5b, 0x3f, 0x32, 0x30, 0x32, 0x36, 0x68]);
const SYNC_END   = Uint8Array.from([0x1b, 0x5b, 0x3f, 0x32, 0x30, 0x32, 0x36, 0x6c]);

function bytesContain(haystack: Uint8Array, needle: Uint8Array): boolean {
  const nLen = needle.length;
  const limit = haystack.length - nLen;
  outer:
  for (let i = 0; i <= limit; i++) {
    for (let j = 0; j < nLen; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

interface UseTerminalOptions {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export function useTerminal({ onData, onResize }: UseTerminalOptions = {}) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const attachedRef = useRef(false);

  // Write batching state — three layers of defense against terminal flash
  // caused by ink TUI redraws + ConPTY fragmentation:
  //
  // Layer 1: DEC 2026 sync detection — buffer between sync start/end sequences
  // Layer 2: Time-based debounce — batch rapid non-sync chunks (4ms quiet, 50ms max)
  // Layer 3: Post-flush scrollToBottom — correct viewport drift from cursor-up sequences
  const writeBatchRef = useRef<Uint8Array[]>([]);
  const syncModeRef = useRef(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceStartRef = useRef(0);

  // Create terminal instance once on hook mount
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
      theme: getXtermTheme(),
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    // Custom key handlers: Ctrl+C copy, Ctrl+V paste
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.ctrlKey && ev.key === "c" && ev.type === "keydown") {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
          return false; // Don't send to PTY
        }
      }
      // Handle Ctrl+V paste — read clipboard and insert into terminal
      if (ev.ctrlKey && ev.key === "v" && ev.type === "keydown") {
        navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text);
        }).catch(() => {});
        return false; // Prevent default handling
      }
      return true; // Let it through
    });

    termRef.current = term;
    fitRef.current = fit;

    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      observerRef.current?.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      attachedRef.current = false;
    };
    // Intentionally empty — create once per hook lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wire up onData/onResize handlers (update when callbacks change)
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const disposables: { dispose(): void }[] = [];

    if (onData) {
      disposables.push(term.onData(onData));
    }
    if (onResize) {
      disposables.push(term.onResize(({ cols, rows }) => onResize(cols, rows)));
    }

    return () => disposables.forEach((d) => d.dispose());
  }, [onData, onResize]);

  // Ref callback to attach terminal to a DOM element
  // WebGL renderer removed — canvas renderer handles ink's cursor-positioning
  // redraws without visible flash (WebGL clears entire GL surface each frame,
  // making intermediate states during ink redraws visible as a flash).
  const attach = useCallback((el: HTMLDivElement | null) => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!el || !term || !fit) return;

    if (attachedRef.current) return; // Already attached — skip fit/observer setup

    term.open(el);
    attachedRef.current = true;

    try {
      fit.fit();
    } catch {}

    // Observe container size changes
    const observer = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  const write = useCallback((data: string) => {
    termRef.current?.write(data);
  }, []);

  // Flush all accumulated write chunks to xterm.js as a single write.
  const flushWrites = useCallback(() => {
    const term = termRef.current;
    if (!term) return;

    const chunks = writeBatchRef.current;
    writeBatchRef.current = [];
    debounceStartRef.current = 0;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (chunks.length === 0) return;

    // Layer 3: snapshot viewport position before write
    const wasAtBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;

    // Merge chunks into a single buffer
    let merged: Uint8Array;
    if (chunks.length === 1) {
      merged = chunks[0];
    } else {
      let totalLen = 0;
      for (const c of chunks) totalLen += c.length;
      merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
    }

    // Single atomic write — xterm.js processes entire ink redraw in one pass
    term.write(merged, () => {
      // After processing, snap viewport to bottom if it was there before.
      // This corrects drift from cursor-up sequences ink uses during redraws.
      if (wasAtBottom) {
        term.scrollToBottom();
      }
    });
  }, []);

  // Sync-aware batched write: handles three cases:
  // 1. Data with DEC 2026 sync start → enter sync mode, accumulate
  // 2. Data with DEC 2026 sync end → flush entire sync buffer atomically
  // 3. Non-sync data → debounce batch (4ms quiet window, 50ms max latency)
  const writeBytes = useCallback((data: Uint8Array) => {
    const term = termRef.current;
    if (!term) return;

    writeBatchRef.current.push(data);

    // Layer 1: DEC 2026 synchronized output detection
    if (bytesContain(data, SYNC_START)) {
      syncModeRef.current = true;
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      // Safety timeout — flush if sync end never arrives
      syncTimeoutRef.current = setTimeout(() => {
        syncModeRef.current = false;
        syncTimeoutRef.current = null;
        flushWrites();
      }, 500);
    }

    if (bytesContain(data, SYNC_END) && syncModeRef.current) {
      syncModeRef.current = false;
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
      flushWrites();
      return;
    }

    // In sync mode — keep accumulating until sync end
    if (syncModeRef.current) return;

    // Layer 2: Time-based debounce for non-sync data
    if (debounceStartRef.current === 0) {
      debounceStartRef.current = performance.now();
    }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (performance.now() - debounceStartRef.current >= 50) {
      // Max latency exceeded — flush now to keep terminal responsive
      flushWrites();
    } else {
      // Wait for more chunks (ConPTY often fragments a single redraw)
      debounceTimerRef.current = setTimeout(flushWrites, 4);
    }
  }, [flushWrites]);

  const clear = useCallback(() => {
    termRef.current?.clear();
  }, []);

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  const fit = useCallback(() => {
    try {
      fitRef.current?.fit();
    } catch {}
  }, []);

  const getDimensions = useCallback(() => {
    const term = termRef.current;
    if (!term) return { cols: 80, rows: 24 };
    return { cols: term.cols, rows: term.rows };
  }, []);

  const getBufferText = useCallback(() => {
    const term = termRef.current;
    if (!term) return "";
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    return lines.join("\n");
  }, []);

  return {
    attach,
    write,
    writeBytes,
    clear,
    focus,
    fit,
    getDimensions,
    getBufferText,
    termRef,
  };
}
