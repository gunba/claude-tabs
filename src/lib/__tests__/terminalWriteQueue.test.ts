import { describe, expect, it } from "vitest";
import {
  createTerminalWriteQueue,
  enqueueTerminalWrite,
  getTerminalWriteQueueDepth,
  resetTerminalWriteQueue,
  takeTerminalWriteBatch,
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
});
