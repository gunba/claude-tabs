import { describe, expect, it } from "vitest";
import {
  createTerminalWriteQueue,
  enqueueTerminalWrite,
  getTerminalWriteQueueDepth,
  previewTerminalWriteChunk,
  resetTerminalWriteQueue,
  takeTerminalWriteBatch,
  terminalWriteBatchPayload,
  terminalWriteQueuedPayload,
} from "../terminalWriteQueue";

describe("terminalWriteQueue", () => {
  it("returns null for an empty queue", () => {
    const queue = createTerminalWriteQueue();
    expect(takeTerminalWriteBatch(queue)).toBeNull();
    expect(getTerminalWriteQueueDepth(queue)).toBe(0);
  });

  it("merges adjacent text chunks", () => {
    const queue = createTerminalWriteQueue();
    enqueueTerminalWrite(queue, "abc");
    enqueueTerminalWrite(queue, "def");
    enqueueTerminalWrite(queue, "ghi");

    expect(takeTerminalWriteBatch(queue)).toEqual({
      data: "abcdefghi",
      chunkCount: 3,
      size: 9,
    });
    expect(getTerminalWriteQueueDepth(queue)).toBe(0);
  });

  it("merges adjacent byte chunks without decoding", () => {
    const queue = createTerminalWriteQueue();
    enqueueTerminalWrite(queue, new Uint8Array([1, 2]));
    enqueueTerminalWrite(queue, new Uint8Array([3]));
    enqueueTerminalWrite(queue, new Uint8Array([4, 5]));

    const batch = takeTerminalWriteBatch(queue);
    expect(batch?.chunkCount).toBe(3);
    expect(batch?.size).toBe(5);
    expect(Array.from(batch?.data as Uint8Array)).toEqual([1, 2, 3, 4, 5]);
    expect(getTerminalWriteQueueDepth(queue)).toBe(0);
  });

  it("does not merge text and byte chunks together", () => {
    const queue = createTerminalWriteQueue();
    enqueueTerminalWrite(queue, "abc");
    enqueueTerminalWrite(queue, new Uint8Array([1, 2]));
    enqueueTerminalWrite(queue, "def");

    expect(takeTerminalWriteBatch(queue)).toEqual({
      data: "abc",
      chunkCount: 1,
      size: 3,
    });
    expect(getTerminalWriteQueueDepth(queue)).toBe(2);

    const bytes = takeTerminalWriteBatch(queue);
    expect(Array.from(bytes?.data as Uint8Array)).toEqual([1, 2]);
    expect(bytes?.chunkCount).toBe(1);
    expect(getTerminalWriteQueueDepth(queue)).toBe(1);

    expect(takeTerminalWriteBatch(queue)).toEqual({
      data: "def",
      chunkCount: 1,
      size: 3,
    });
    expect(getTerminalWriteQueueDepth(queue)).toBe(0);
  });

  it("resets queue state in place", () => {
    const queue = createTerminalWriteQueue();
    enqueueTerminalWrite(queue, "abc");
    resetTerminalWriteQueue(queue);
    enqueueTerminalWrite(queue, "def");

    expect(takeTerminalWriteBatch(queue)).toEqual({
      data: "def",
      chunkCount: 1,
      size: 3,
    });
  });

  it("builds text preview payloads", () => {
    const preview = previewTerminalWriteChunk("a\tb\n");

    expect(preview).toMatchObject({
      kind: "text",
      size: 4,
      text: "a\tb\n",
      preview: "a\\tb\\n",
      containsLF: true,
    });
    expect(terminalWriteQueuedPayload(preview, 2)).toEqual({
      length: 4,
      preview: "a\\tb\\n",
      queueDepth: 2,
    });
    expect(terminalWriteBatchPayload(preview, 3, 4)).toEqual({
      chunkCount: 3,
      queueDepth: 4,
      length: 4,
      text: "a\tb\n",
      preview: "a\\tb\\n",
    });
  });

  it("builds byte preview payloads", () => {
    const preview = previewTerminalWriteChunk(new Uint8Array([0x1b, 0x0d, 0x0a]));

    expect(preview).toMatchObject({
      kind: "bytes",
      size: 3,
      text: "\x1b\r\n",
      preview: "\\x1b\\r\\n",
      containsEscape: true,
      containsCR: true,
      containsLF: true,
    });
    expect(terminalWriteQueuedPayload(preview, 1)).toEqual({
      byteLength: 3,
      containsEscape: true,
      containsCR: true,
      containsLF: true,
      text: "\x1b\r\n",
      preview: "\\x1b\\r\\n",
      queueDepth: 1,
    });
  });
});
