export type TerminalWriteChunk = string | Uint8Array;

export interface TerminalWriteBatch {
  data: TerminalWriteChunk;
  chunkCount: number;
  size: number;
}

export interface TerminalWriteQueue {
  chunks: TerminalWriteChunk[];
  head: number;
}

export const TERMINAL_WRITE_BATCH_MAX_BYTES = 256 * 1024;
export const TERMINAL_WRITE_BATCH_MAX_STRING_CHARS = 256 * 1024;

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
