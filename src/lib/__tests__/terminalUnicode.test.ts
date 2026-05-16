import { describe, expect, it } from "vitest";
import type { IUnicodeVersionProvider, Terminal } from "@xterm/xterm";
import {
  activateTerminalUnicodeProvider,
  CODE_TABS_UNICODE_VERSION,
  createCodeTabsUnicodeProvider,
  measureUnicodeStringWidth,
} from "../terminalUnicode";

type UnicodeCellWidth = 0 | 1 | 2;

const SHOULD_JOIN_MASK = 1;
const WIDTH_SHIFT = 1;
const KIND_SHIFT = 3;

function extractWidth(value: number): UnicodeCellWidth {
  return ((value >> WIDTH_SHIFT) & 0x3) as UnicodeCellWidth;
}

function createPropertyValue(kind: number, width: number, shouldJoin = false): number {
  return (kind << KIND_SHIFT) | ((width & 0x3) << WIDTH_SHIFT) | (shouldJoin ? SHOULD_JOIN_MASK : 0);
}

function baseWidth(codepoint: number): UnicodeCellWidth {
  if (
    codepoint === 0x200d ||
    codepoint === 0xfe0f ||
    codepoint === 0x20e3 ||
    (codepoint >= 0x0300 && codepoint <= 0x036f)
  ) {
    return 0;
  }
  if (
    codepoint === 0x2705 ||
    codepoint === 0x1f468 ||
    codepoint === 0x1f4bb ||
    codepoint === 0x1f44d ||
    codepoint === 0x1f7e6 ||
    (codepoint >= 0x1f3fb && codepoint <= 0x1f3ff)
  ) {
    return 2;
  }
  return 1;
}

const unicode11LikeProvider: IUnicodeVersionProvider = {
  version: "11",
  wcwidth: baseWidth,
  charProperties(codepoint, preceding) {
    let width = baseWidth(codepoint);
    let shouldJoin = width === 0 && preceding !== 0;
    if (shouldJoin) {
      const oldWidth = extractWidth(preceding);
      if (oldWidth === 0) {
        shouldJoin = false;
      } else if (oldWidth > width) {
        width = oldWidth;
      }
    }
    return createPropertyValue(0, width, shouldJoin);
  },
};

function mockTerminal() {
  const providers = new Map<string, IUnicodeVersionProvider>([
    ["6", unicode11LikeProvider],
  ]);
  let activeVersion = "6";
  let activeProvider = unicode11LikeProvider;

  const unicode = {
    get activeVersion() {
      return activeVersion;
    },
    set activeVersion(version: string) {
      const provider = providers.get(version);
      if (!provider) throw new Error(`unknown Unicode version "${version}"`);
      activeVersion = version;
      activeProvider = provider;
    },
    get versions() {
      return [...providers.keys()];
    },
    get _activeProvider() {
      return activeProvider;
    },
    register(provider: IUnicodeVersionProvider) {
      providers.set(provider.version, provider);
    },
    getStringCellWidth(text: string) {
      return measureUnicodeStringWidth(activeProvider, text);
    },
  };

  const term = {
    unicode,
    loadAddon(addon: { activate(terminal: Terminal): void }) {
      addon.activate(term as unknown as Terminal);
    },
  };

  return term as unknown as Pick<Terminal, "unicode" | "loadAddon">;
}

function mockWrappedTerminal() {
  const direct = mockTerminal() as unknown as {
    unicode: Pick<Terminal["unicode"], "activeVersion" | "versions" | "register"> & {
      getStringCellWidth(text: string): number;
      _activeProvider: IUnicodeVersionProvider;
    };
    loadAddon(addon: { activate(terminal: Terminal): void }): void;
  };
  const service = direct.unicode;
  const api = {
    get activeVersion() {
      return service.activeVersion;
    },
    set activeVersion(version: string) {
      service.activeVersion = version;
    },
    get versions() {
      return service.versions;
    },
    register(provider: IUnicodeVersionProvider) {
      service.register(provider);
    },
    _core: {
      unicodeService: service,
    },
  };

  const term = {
    unicode: api,
    loadAddon(addon: { activate(terminal: Terminal): void }) {
      addon.activate(term as unknown as Terminal);
    },
  };

  return term as unknown as Pick<Terminal, "unicode" | "loadAddon">;
}

describe("createCodeTabsUnicodeProvider", () => {
  it("keeps Unicode 11 width for bare wide emoji", () => {
    const provider = createCodeTabsUnicodeProvider(unicode11LikeProvider);

    expect(measureUnicodeStringWidth(provider, "\u2705")).toBe(2);
    expect(measureUnicodeStringWidth(provider, "\u{1f7e6}")).toBe(2);
  });

  it("widens emoji variation-selector sequences to two cells", () => {
    const provider = createCodeTabsUnicodeProvider(unicode11LikeProvider);

    expect(measureUnicodeStringWidth(unicode11LikeProvider, "\u2714\ufe0f")).toBe(1);
    expect(measureUnicodeStringWidth(provider, "\u2714\ufe0f")).toBe(2);
    expect(measureUnicodeStringWidth(provider, "\u26a0\ufe0f")).toBe(2);
  });

  it("keeps ZWJ emoji clusters at two cells", () => {
    const provider = createCodeTabsUnicodeProvider(unicode11LikeProvider);

    expect(measureUnicodeStringWidth(unicode11LikeProvider, "\u{1f468}\u200d\u{1f4bb}")).toBe(4);
    expect(measureUnicodeStringWidth(provider, "\u{1f468}\u200d\u{1f4bb}")).toBe(2);
  });

  it("keeps emoji modifier sequences at two cells", () => {
    const provider = createCodeTabsUnicodeProvider(unicode11LikeProvider);

    expect(measureUnicodeStringWidth(unicode11LikeProvider, "\u{1f44d}\u{1f3fd}")).toBe(4);
    expect(measureUnicodeStringWidth(provider, "\u{1f44d}\u{1f3fd}")).toBe(2);
  });
});

describe("activateTerminalUnicodeProvider", () => {
  it("registers and verifies the Code Tabs Unicode provider", () => {
    const term = mockTerminal();
    const result = activateTerminalUnicodeProvider(term, {
      addonFactory: () => ({
        activate(terminal) {
          terminal.unicode.register(unicode11LikeProvider);
        },
        dispose() {},
      }),
    });

    expect(term.unicode.activeVersion).toBe(CODE_TABS_UNICODE_VERSION);
    expect(term.unicode.versions).toContain(CODE_TABS_UNICODE_VERSION);
    expect(result.diagnostics.probes.every((probe) => probe.ok)).toBe(true);
  });

  it("supports xterm's public UnicodeApi wrapper shape", () => {
    const term = mockWrappedTerminal();
    const result = activateTerminalUnicodeProvider(term, {
      addonFactory: () => ({
        activate(terminal) {
          terminal.unicode.register(unicode11LikeProvider);
        },
        dispose() {},
      }),
    });

    expect(term.unicode.activeVersion).toBe(CODE_TABS_UNICODE_VERSION);
    expect(result.diagnostics.probes.every((probe) => probe.ok)).toBe(true);
  });
});
