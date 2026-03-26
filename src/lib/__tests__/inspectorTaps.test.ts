/* eslint-disable @typescript-eslint/no-explicit-any */
declare const process: any;
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { INSTALL_TAPS, tapToggleExpr, tapToggleAllExpr } from "../inspectorHooks";

// Snapshot ALL patchable globals once at module load, before any INSTALL_TAPS.
const _pristine = {
  jsonParse: JSON.parse,
  jsonStringify: JSON.stringify,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  stdoutWrite: process.stdout.write,
  stderrWrite: process.stderr.write,
  consoleLog: console.log,
  consoleWarn: console.warn,
  consoleError: console.error,
  consoleDebug: console.debug,
  processExit: process.exit,
};

function restoreGlobals() {
  JSON.parse = _pristine.jsonParse;
  JSON.stringify = _pristine.jsonStringify;
  globalThis.setTimeout = _pristine.setTimeout;
  globalThis.clearTimeout = _pristine.clearTimeout;
  globalThis.setInterval = _pristine.setInterval;
  globalThis.clearInterval = _pristine.clearInterval;
  process.stdout.write = _pristine.stdoutWrite;
  process.stderr.write = _pristine.stderrWrite;
  console.log = _pristine.consoleLog;
  console.warn = _pristine.consoleWarn;
  console.error = _pristine.consoleError;
  console.debug = _pristine.consoleDebug;
  process.exit = _pristine.processExit;
}

function cleanupTapHooks() {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.__tapsInstalled;
  delete g.__tapFlags;
  delete g.__tapFetchInstalled;
  delete g.__tapFetchTimeoutInstalled;
  restoreGlobals();
}

/** Mute always-on parse/stringify flags to prevent vitest's internal JSON ops from flooding the spy. */
function muteTapDefaults() {
  const g = globalThis as unknown as Record<string, unknown>;
  const flags = g.__tapFlags as Record<string, boolean> | undefined;
  if (flags) { flags.parse = false; flags.stringify = false; }
}

/** Pre-compiled INSTALL_TAPS function. */
const _installTapsFn = new Function(`return ${INSTALL_TAPS}`);

/** Collect TAP entries pushed via console.debug with \x00TAP prefix.
 *  Uses _pristine.jsonParse to avoid triggering the wrapped JSON.parse (which would infinite-loop). */
function collectTapEntries(debugSpy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  const calls = debugSpy.mock.calls.slice(); // snapshot to avoid mutation during iteration
  for (const call of calls) {
    const arg = call[0];
    if (typeof arg === "string" && arg.startsWith("\x00TAP")) {
      try { entries.push(_pristine.jsonParse(arg.slice(4))); } catch {}
    }
  }
  return entries;
}

describe("INSTALL_TAPS", () => {
  beforeEach(cleanupTapHooks);
  afterEach(cleanupTapHooks);

  it("returns 'ok' on first install", () => {
    expect(_installTapsFn()).toBe("ok");
  });

  it("returns 'already' on second install", () => {
    _installTapsFn();
    expect(_installTapsFn()).toBe("already");
  });

  it("initializes __tapFlags with parse+stringify always-on", () => {
    _installTapsFn();
    const g = globalThis as unknown as Record<string, unknown>;
    const flags = g.__tapFlags as Record<string, boolean>;
    expect(flags.parse).toBe(true);
    expect(flags.stringify).toBe(true);
    expect(flags.console).toBe(false);
    expect(flags.fs).toBe(false);
    expect(flags.spawn).toBe(false);
    expect(flags.fetch).toBe(false);
    expect(flags.exit).toBe(false);
    expect(flags.timer).toBe(false);
    expect(flags.stdout).toBe(false);
    expect(flags.require).toBe(false);
  });
});

describe("INSTALL_TAPS JSON.parse hook", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanupTapHooks();
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    _installTapsFn();
    muteTapDefaults();
  });
  afterEach(() => {
    cleanupTapHooks();
    debugSpy.mockRestore();
  });

  it("pushes parse entries via console.debug (parse is always-on)", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).parse = true;
    debugSpy.mockClear();
    const big = JSON.stringify({ type: "message", content: "x".repeat(100) });
    JSON.parse(big);
    const entries = collectTapEntries(debugSpy);
    const parseEntries = entries.filter((e) => e.cat === "parse");
    expect(parseEntries.length).toBeGreaterThanOrEqual(1);
    const entry = parseEntries[parseEntries.length - 1];
    expect(entry.cat).toBe("parse");
    expect(typeof entry.ts).toBe("number");
    expect(typeof entry.len).toBe("number");
    expect(typeof entry.snap).toBe("string");
  });

  it("is no-op when parse flag is disabled", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).parse = false;
    debugSpy.mockClear();
    const big = JSON.stringify({ type: "message", content: "x".repeat(100) });
    JSON.parse(big);
    const entries = collectTapEntries(debugSpy).filter((e) => e.cat === "parse");
    expect(entries.length).toBe(0);
  });

  it("captures short strings (no length filter)", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).parse = true;
    debugSpy.mockClear();
    JSON.parse('{"a":1}');
    const entries = collectTapEntries(debugSpy).filter((e) => e.cat === "parse");
    expect(entries.length).toBe(1);
  });

  it("captures primitives (no type filter)", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).parse = true;
    debugSpy.mockClear();
    JSON.parse('"hello"');
    const entries = collectTapEntries(debugSpy).filter((e) => e.cat === "parse");
    expect(entries.length).toBe(1);
  });
});

describe("INSTALL_TAPS console hooks", () => {
  let origLog: typeof console.log;
  let origWarn: typeof console.warn;
  let origError: typeof console.error;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanupTapHooks();
    origLog = console.log;
    origWarn = console.warn;
    origError = console.error;
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    _installTapsFn();
    muteTapDefaults();
  });
  afterEach(() => {
    cleanupTapHooks();
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    debugSpy.mockRestore();
  });

  it("captures console.warn when flag is true", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).console = true;
    debugSpy.mockClear();
    console.warn("test warning");
    const entries = collectTapEntries(debugSpy).filter((e) => e.cat === "console.warn");
    expect(entries.length).toBe(1);
    expect(entries[0].msg).toBe("test warning");
  });

  it("is no-op when console flag is false", () => {
    debugSpy.mockClear();
    console.log("invisible");
    const entries = collectTapEntries(debugSpy).filter((e) => String(e.cat).startsWith("console."));
    expect(entries.length).toBe(0);
  });
});

describe("tapToggleExpr / tapToggleAllExpr", () => {
  beforeEach(() => { cleanupTapHooks(); _installTapsFn(); muteTapDefaults(); });
  afterEach(cleanupTapHooks);

  it("toggles a single category", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    new Function(`return ${tapToggleExpr("parse", true)}`)();
    expect((g.__tapFlags as Record<string, boolean>).parse).toBe(true);
    expect((g.__tapFlags as Record<string, boolean>).console).toBe(false);
    new Function(`return ${tapToggleExpr("parse", false)}`)();
    expect((g.__tapFlags as Record<string, boolean>).parse).toBe(false);
  });

  it("toggles all optional categories (parse+stringify stay always-on)", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const flags = g.__tapFlags as Record<string, boolean>;
    // Restore parse+stringify to their default always-on state before testing toggleAll
    flags.parse = true;
    flags.stringify = true;
    new Function(`return ${tapToggleAllExpr(true)}`)();
    // parse and stringify unchanged by toggleAll (always-on)
    expect(flags.parse).toBe(true);
    expect(flags.stringify).toBe(true);
    expect(flags.console).toBe(true);
    expect(flags.fs).toBe(true);
    expect(flags.spawn).toBe(true);
    expect(flags.fetch).toBe(true);
    expect(flags.exit).toBe(true);
    expect(flags.timer).toBe(true);
    expect(flags.stdout).toBe(true);
    expect(flags.stderr).toBe(true);
    expect(flags.require).toBe(true);
    expect(flags.bun).toBe(true);
    new Function(`return ${tapToggleAllExpr(false)}`)();
    expect(flags.parse).toBe(true);
    expect(flags.stringify).toBe(true);
    expect(flags.console).toBe(false);
    expect(flags.fs).toBe(false);
    expect(flags.spawn).toBe(false);
    expect(flags.fetch).toBe(false);
    expect(flags.exit).toBe(false);
    expect(flags.timer).toBe(false);
    expect(flags.stdout).toBe(false);
    expect(flags.stderr).toBe(false);
    expect(flags.require).toBe(false);
    expect(flags.bun).toBe(false);
  });

  it("toggles new categories individually", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const flags = g.__tapFlags as Record<string, boolean>;
    new Function(`return ${tapToggleExpr("spawn", true)}`)();
    expect(flags.spawn).toBe(true);
    expect(flags.fetch).toBe(false);
    new Function(`return ${tapToggleExpr("fetch", true)}`)();
    expect(flags.fetch).toBe(true);
    new Function(`return ${tapToggleExpr("timer", true)}`)();
    expect(flags.timer).toBe(true);
    new Function(`return ${tapToggleExpr("stdout", true)}`)();
    expect(flags.stdout).toBe(true);
  });

  it("tapToggleExpr is safe when __tapFlags is absent", () => {
    cleanupTapHooks();
    const result = new Function(`return ${tapToggleExpr("parse", true)}`)();
    expect(result).toBe("ok");
  });
});

describe("INSTALL_TAPS console hooks — all methods", () => {
  let origLog: typeof console.log;
  let origWarn: typeof console.warn;
  let origError: typeof console.error;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanupTapHooks();
    origLog = console.log;
    origWarn = console.warn;
    origError = console.error;
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    _installTapsFn();
    muteTapDefaults();
  });
  afterEach(() => {
    cleanupTapHooks();
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    debugSpy.mockRestore();
  });

  it("captures console.log", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).console = true;
    debugSpy.mockClear();
    console.log("test log");
    const entries = collectTapEntries(debugSpy);
    expect(entries.some((e) => e.cat === "console.log" && e.msg === "test log")).toBe(true);
  });

  it("captures console.error", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).console = true;
    debugSpy.mockClear();
    console.error("test error");
    const entries = collectTapEntries(debugSpy);
    expect(entries.some((e) => e.cat === "console.error" && e.msg === "test error")).toBe(true);
  });

  it("joins multiple arguments with space", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).console = true;
    debugSpy.mockClear();
    console.log("a", "b", "c");
    const entries = collectTapEntries(debugSpy);
    expect(entries.some((e) => e.msg === "a b c")).toBe(true);
  });
});

describe("INSTALL_TAPS stdout hook", () => {
  const proc = () => (globalThis as unknown as { process: { stdout: { write: (s: string) => boolean } } }).process;
  let origWrite: (s: string) => boolean;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanupTapHooks();
    origWrite = proc().stdout.write;
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    _installTapsFn();
    muteTapDefaults();
  });
  afterEach(() => {
    cleanupTapHooks();
    proc().stdout.write = origWrite;
    debugSpy.mockRestore();
  });

  it("captures stdout.write with length and snap", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).stdout = true;
    debugSpy.mockClear();
    proc().stdout.write("test output");
    const entries = collectTapEntries(debugSpy).filter((e) => e.cat === "stdout");
    expect(entries.length).toBe(1);
    expect(entries[0].len).toBe(11);
    expect(entries[0].snap).toBe("test output");
  });

  it("is no-op when stdout flag is false", () => {
    debugSpy.mockClear();
    proc().stdout.write("invisible");
    const entries = collectTapEntries(debugSpy).filter((e) => e.cat === "stdout");
    expect(entries.length).toBe(0);
  });
});

describe("INSTALL_TAPS timer hook", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanupTapHooks();
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    _installTapsFn();
    muteTapDefaults();
  });
  afterEach(() => {
    cleanupTapHooks();
    debugSpy.mockRestore();
  });

  it("captures setTimeout with delay >= 100", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).timer = true;
    debugSpy.mockClear();
    const id = setTimeout(() => {}, 200);
    clearTimeout(id);
    const entries = collectTapEntries(debugSpy).filter((e) => e.cat === "setTimeout");
    expect(entries.length).toBe(1);
    expect(entries[0].delay).toBe(200);
    expect(typeof entries[0].caller).toBe("string");
  });

  it("skips setTimeout with delay < 100", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    (g.__tapFlags as Record<string, boolean>).timer = true;
    debugSpy.mockClear();
    const id = setTimeout(() => {}, 10);
    clearTimeout(id);
    const entries = collectTapEntries(debugSpy).filter((e) => e.cat === "setTimeout");
    expect(entries.length).toBe(0);
  });
});
