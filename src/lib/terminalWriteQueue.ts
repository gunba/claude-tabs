// [DF-03] [PT-16] Append-only chunk queue with O(1) head pointer + adaptive compaction; merges adjacent same-type chunks (text or bytes) into batches up to 256KB / 256K chars for a single term.write call.
export type TerminalWriteChunk = string | Uint8Array;
export type TerminalWriteChunkKind = "text" | "bytes";

export interface TerminalWriteBatch {
  data: TerminalWriteChunk;
  chunkCount: number;
  size: number;
}

export interface TerminalWriteQueue {
  chunks: TerminalWriteChunk[];
  head: number;
}

export interface TerminalWriteChunkPreview {
  kind: TerminalWriteChunkKind;
  size: number;
  text: string;
  preview: string;
  containsEscape: boolean;
  containsCR: boolean;
  containsLF: boolean;
}

export const TERMINAL_WRITE_BATCH_MAX_BYTES = 256 * 1024;
export const TERMINAL_WRITE_BATCH_MAX_STRING_CHARS = 256 * 1024;

const terminalWriteDecoder = new TextDecoder();

export function createTerminalWriteQueue(): TerminalWriteQueue {
  return { chunks: [], head: 0 };
}

export function getTerminalWriteQueueDepth(queue: TerminalWriteQueue): number {
  return queue.chunks.length - queue.head;
}

export function resetTerminalWriteQueue(queue: TerminalWriteQueue): void {
  queue.chunks = [];
  queue.head = 0;
}

export function enqueueTerminalWrite(queue: TerminalWriteQueue, chunk: TerminalWriteChunk): void {
  queue.chunks.push(chunk);
}

function escapeTerminalWritePreview(text: string): string {
  return text
    .replace(/\x1b/g, "\\x1b")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .slice(0, 240);
}

export function previewTerminalWriteChunk(chunk: TerminalWriteChunk): TerminalWriteChunkPreview {
  const kind: TerminalWriteChunkKind = typeof chunk === "string" ? "text" : "bytes";
  const text = typeof chunk === "string" ? chunk : terminalWriteDecoder.decode(chunk);
  return {
    kind,
    size: typeof chunk === "string" ? chunk.length : chunk.byteLength,
    text,
    preview: escapeTerminalWritePreview(text),
    containsEscape: text.includes("\x1b"),
    containsCR: text.includes("\r"),
    containsLF: text.includes("\n"),
  };
}

function terminalWriteSizePayload(preview: TerminalWriteChunkPreview): { length: number } | { byteLength: number } {
  return preview.kind === "bytes" ? { byteLength: preview.size } : { length: preview.size };
}

function terminalWriteByteDiagnosticPayload(preview: TerminalWriteChunkPreview) {
  return {
    containsEscape: preview.containsEscape,
    containsCR: preview.containsCR,
    containsLF: preview.containsLF,
  };
}

export function terminalWriteMetricPayload(preview: TerminalWriteChunkPreview) {
  return {
    ...terminalWriteSizePayload(preview),
    preview: preview.preview,
  };
}

export function terminalWriteQueuedPayload(preview: TerminalWriteChunkPreview, queueDepth: number) {
  return preview.kind === "bytes"
    ? {
        ...terminalWriteSizePayload(preview),
        ...terminalWriteByteDiagnosticPayload(preview),
        text: preview.text,
        preview: preview.preview,
        queueDepth,
      }
    : {
        ...terminalWriteSizePayload(preview),
        preview: preview.preview,
        queueDepth,
      };
}

export function terminalWriteBatchPayload(
  preview: TerminalWriteChunkPreview,
  chunkCount: number,
  queueDepth: number
) {
  return preview.kind === "bytes"
    ? {
        chunkCount,
        queueDepth,
        ...terminalWriteSizePayload(preview),
        ...terminalWriteByteDiagnosticPayload(preview),
        text: preview.text,
        preview: preview.preview,
      }
    : {
        chunkCount,
        queueDepth,
        ...terminalWriteSizePayload(preview),
        text: preview.text,
        preview: preview.preview,
      };
}

export function terminalWriteAppliedPayload(preview: TerminalWriteChunkPreview, chunkCount: number) {
  return {
    chunkCount,
    ...terminalWriteSizePayload(preview),
  };
}

function compactTerminalWriteQueue(queue: TerminalWriteQueue): void {
  if (queue.head === 0) return;
  if (queue.head >= queue.chunks.length) {
    resetTerminalWriteQueue(queue);
    return;
  }
  if (queue.head > 1024 && queue.head * 2 > queue.chunks.length) {
    queue.chunks = queue.chunks.slice(queue.head);
    queue.head = 0;
  }
}

function dequeueTerminalWrite(queue: TerminalWriteQueue): TerminalWriteChunk | undefined {
  if (queue.head >= queue.chunks.length) {
    resetTerminalWriteQueue(queue);
    return undefined;
  }
  const chunk = queue.chunks[queue.head];
  queue.head += 1;
  compactTerminalWriteQueue(queue);
  return chunk;
}

function peekTerminalWrite(queue: TerminalWriteQueue): TerminalWriteChunk | undefined {
  return queue.chunks[queue.head];
}

export function takeTerminalWriteBatch(queue: TerminalWriteQueue): TerminalWriteBatch | null {
  const first = dequeueTerminalWrite(queue);
  if (first === undefined) return null;

  if (typeof first === "string") {
    const chunks = [first];
    let size = first.length;
    while (typeof peekTerminalWrite(queue) === "string" && size < TERMINAL_WRITE_BATCH_MAX_STRING_CHARS) {
      const next = dequeueTerminalWrite(queue) as string;
      chunks.push(next);
      size += next.length;
    }
    return {
      data: chunks.length === 1 ? first : chunks.join(""),
      chunkCount: chunks.length,
      size,
    };
  }

  const chunks = [first];
  let size = first.byteLength;
  while (peekTerminalWrite(queue) instanceof Uint8Array && size < TERMINAL_WRITE_BATCH_MAX_BYTES) {
    const next = dequeueTerminalWrite(queue) as Uint8Array;
    chunks.push(next);
    size += next.byteLength;
  }
  if (chunks.length === 1) {
    return { data: first, chunkCount: 1, size };
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { data: merged, chunkCount: chunks.length, size };
}
