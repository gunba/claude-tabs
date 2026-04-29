import { useCallback, useEffect, type MutableRefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { dlog, shouldRecordDebugLog } from "../lib/debugLog";
import { startTraceSpan } from "../lib/perfTrace";
import {
  enqueueTerminalWrite,
  getTerminalWriteQueueDepth,
  previewTerminalWriteChunk,
  takeTerminalWriteBatch,
  terminalWriteAppliedPayload,
  terminalWriteBatchPayload,
  terminalWriteMetricPayload,
  terminalWriteQueuedPayload,
  type TerminalWriteChunk,
  type TerminalWriteQueue,
} from "../lib/terminalWriteQueue";
import { captureBufferState } from "./terminalShared";

interface UseTerminalWriteSinkParams {
  sessionIdRef: MutableRefObject<string | null>;
  termRef: MutableRefObject<Terminal | null>;
  visible: boolean;
  visibleRef: MutableRefObject<boolean>;
  writeInFlightRef: MutableRefObject<boolean>;
  writeQueueRef: MutableRefObject<TerminalWriteQueue>;
}

export function useTerminalWriteSink({
  sessionIdRef,
  termRef,
  visible,
  visibleRef,
  writeInFlightRef,
  writeQueueRef,
}: UseTerminalWriteSinkParams): {
  write: (data: string) => void;
  writeBytes: (data: Uint8Array) => void;
} {
  const flushWriteQueue = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    // Hidden tabs keep raw output queued; xterm parsing/rendering catches up on activation.
    if (!visibleRef.current) return;
    if (writeInFlightRef.current) return;
    const queuedChunks = getTerminalWriteQueueDepth(writeQueueRef.current);
    const batch = takeTerminalWriteBatch(writeQueueRef.current);
    if (!batch) return;

    const sid = sessionIdRef.current;
    const isBytes = batch.data instanceof Uint8Array;
    const debug = shouldRecordDebugLog("DEBUG", sid);
    let writePreview: ReturnType<typeof previewTerminalWriteChunk> | null = null;
    const getWritePreview = () => writePreview ??= previewTerminalWriteChunk(batch.data);
    const span = startTraceSpan(isBytes ? "terminal.write_bytes_apply" : "terminal.write_text_apply", {
      module: "terminal",
      sessionId: sid,
      event: isBytes ? "terminal.write_bytes_perf" : "terminal.write_text_perf",
      emitStart: false,
      warnAboveMs: 16,
      data: () => ({
        chunkCount: batch.chunkCount,
        queueDepth: queuedChunks,
        ...terminalWriteMetricPayload(getWritePreview()),
      }),
    });
    if (debug) {
      dlog("terminal", sid, isBytes ? "terminal write(bytes) batch" : "terminal write(text) batch", "DEBUG", {
        event: isBytes ? "terminal.write_bytes_batch" : "terminal.write_text_batch",
        data: terminalWriteBatchPayload(getWritePreview(), batch.chunkCount, queuedChunks),
      });
    }
    writeInFlightRef.current = true;
    try {
      term.write(batch.data, () => {
        if (termRef.current !== term) return;
        span.end(() => ({
          after: captureBufferState(term),
        }));
        if (debug) {
          dlog("terminal", sid, isBytes ? "terminal write(bytes) applied" : "terminal write(text) applied", "DEBUG", {
            event: isBytes ? "terminal.write_bytes_applied" : "terminal.write_text_applied",
            data: {
              ...terminalWriteAppliedPayload(getWritePreview(), batch.chunkCount),
              after: captureBufferState(term),
            },
          });
        }
        writeInFlightRef.current = false;
        queueMicrotask(flushWriteQueue);
      });
    } catch (err) {
      span.fail(err);
      writeInFlightRef.current = false;
      dlog("terminal", sid, `term.write error: ${err}`, "ERR");
      queueMicrotask(flushWriteQueue);
    }
  }, [sessionIdRef, termRef, visibleRef, writeInFlightRef, writeQueueRef]);

  useEffect(() => {
    if (visible) {
      flushWriteQueue();
    }
  }, [flushWriteQueue, visible]);

  const enqueueTerminalChunk = useCallback((data: TerminalWriteChunk) => {
    if (!termRef.current) return;
    const sid = sessionIdRef.current;
    if (shouldRecordDebugLog("DEBUG", sid)) {
      const preview = previewTerminalWriteChunk(data);
      const isBytes = preview.kind === "bytes";
      dlog("terminal", sid, isBytes ? "terminal write(bytes) queued" : "terminal write(text) queued", "DEBUG", {
        event: isBytes ? "terminal.write_bytes_queued" : "terminal.write_text_queued",
        data: terminalWriteQueuedPayload(preview, getTerminalWriteQueueDepth(writeQueueRef.current)),
      });
    }
    enqueueTerminalWrite(writeQueueRef.current, data);
    flushWriteQueue();
  }, [flushWriteQueue, sessionIdRef, termRef, writeQueueRef]);

  const write = useCallback((data: string) => {
    enqueueTerminalChunk(data);
  }, [enqueueTerminalChunk]);

  // [PT-16] [DF-03] Write raw bytes to terminal.
  const writeBytes = useCallback((data: Uint8Array) => {
    enqueueTerminalChunk(data);
  }, [enqueueTerminalChunk]);

  return { write, writeBytes };
}
