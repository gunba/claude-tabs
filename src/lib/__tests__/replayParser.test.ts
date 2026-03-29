import { describe, it, expect } from "vitest";
import { parseRecording, decodePayload } from "../replayParser";

const header = JSON.stringify({ version: 1, cols: 80, rows: 24, timestamp: 1700000000 });
const event1 = JSON.stringify({ t: 0.1, phase: "raw", base64: btoa("hello") });
const event2 = JSON.stringify({ t: 0.2, phase: "filtered", base64: btoa("hello") });
const event3 = JSON.stringify({ t: 0.5, phase: "final", base64: btoa("hello") });
const resize = JSON.stringify({ t: 1.0, phase: "resize", cols: 120, rows: 40 });

describe("parseRecording", () => {
  it("parses header and events", () => {
    const text = [header, event1, event2, event3].join("\n");
    const result = parseRecording(text);
    expect(result.header).toEqual({ version: 1, cols: 80, rows: 24, timestamp: 1700000000 });
    expect(result.events).toHaveLength(3);
    expect(result.duration).toBeCloseTo(0.5);
  });

  it("handles resize events", () => {
    const text = [header, resize].join("\n");
    const result = parseRecording(text);
    expect(result.events[0].phase).toBe("resize");
    expect(result.events[0].cols).toBe(120);
    expect(result.events[0].rows).toBe(40);
  });

  it("handles empty events (header only)", () => {
    const result = parseRecording(header);
    expect(result.events).toHaveLength(0);
    expect(result.duration).toBe(0);
  });

  it("skips blank lines", () => {
    const text = [header, "", event1, "", event3, ""].join("\n");
    const result = parseRecording(text);
    expect(result.events).toHaveLength(2);
  });

  it("throws on empty file", () => {
    expect(() => parseRecording("")).toThrow("Empty recording file");
  });

  it("throws on unsupported version", () => {
    const bad = JSON.stringify({ version: 99, cols: 80, rows: 24, timestamp: 0 });
    expect(() => parseRecording(bad)).toThrow("Unsupported recording version: 99");
  });
});

describe("decodePayload", () => {
  it("decodes base64 to Uint8Array", () => {
    const encoded = btoa("hello world");
    const result = decodePayload(encoded);
    expect(new TextDecoder().decode(result)).toBe("hello world");
  });

  it("handles binary data", () => {
    const bytes = new Uint8Array([0, 1, 27, 91, 50, 74]); // includes ESC[2J
    const encoded = btoa(String.fromCharCode(...bytes));
    const result = decodePayload(encoded);
    expect(result).toEqual(bytes);
  });
});
