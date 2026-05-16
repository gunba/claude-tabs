import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { IUnicodeVersionProvider, Terminal } from "@xterm/xterm";

export const CODE_TABS_UNICODE_VERSION = "code-tabs-unicode11-emoji";

type UnicodeCellWidth = 0 | 1 | 2;

export interface TerminalUnicodeAddon {
  activate(terminal: Terminal): void;
  dispose(): void;
}

interface RuntimeUnicode {
  activeVersion: string;
  readonly versions: ReadonlyArray<string>;
  register(provider: IUnicodeVersionProvider): void;
}

interface RuntimeUnicodeService extends RuntimeUnicode {
  wcwidth?: (codepoint: number) => UnicodeCellWidth;
  getStringCellWidth?: (text: string) => number;
  _activeProvider?: IUnicodeVersionProvider;
}

interface RuntimeUnicodeApi extends RuntimeUnicodeService {
  _core?: {
    unicodeService?: RuntimeUnicodeService;
  };
}

export interface TerminalUnicodeProbe {
  label: string;
  text: string;
  expected: number;
  actual: number | null;
  ok: boolean;
}

export interface TerminalUnicodeDiagnostics {
  activeVersion: string;
  versions: string[];
  probes: TerminalUnicodeProbe[];
}

interface ActivateTerminalUnicodeOptions {
  addonFactory?: () => TerminalUnicodeAddon;
}

const SHOULD_JOIN_MASK = 1;
const WIDTH_SHIFT = 1;
const WIDTH_MASK = 0x3;
const KIND_SHIFT = 3;
const KIND_MASK = 0xffffff;

const KIND_EMOJI_CLUSTER = 1;
const KIND_EMOJI_ZWJ = 2;
const KIND_EMOJI_VARIATION_BASE = 3;

const REQUIRED_WIDTH_PROBES = [
  { label: "check_mark_button", text: "\u2705", expected: 2 },
  { label: "blue_square", text: "\u{1f7e6}", expected: 2 },
  { label: "heavy_check_mark_emoji", text: "\u2714\ufe0f", expected: 2 },
  { label: "warning_emoji", text: "\u26a0\ufe0f", expected: 2 },
  { label: "zwj_emoji", text: "\u{1f468}\u200d\u{1f4bb}", expected: 2 },
] as const;

export class TerminalUnicodeActivationError extends Error {
  readonly diagnostics: TerminalUnicodeDiagnostics;
  readonly cause: unknown;

  constructor(message: string, diagnostics: TerminalUnicodeDiagnostics, cause?: unknown) {
    super(message);
    this.name = "TerminalUnicodeActivationError";
    this.diagnostics = diagnostics;
    this.cause = cause;
  }
}

function extractShouldJoin(value: number): boolean {
  return (value & SHOULD_JOIN_MASK) !== 0;
}

function extractWidth(value: number): UnicodeCellWidth {
  return ((value >> WIDTH_SHIFT) & WIDTH_MASK) as UnicodeCellWidth;
}

function extractKind(value: number): number {
  return value >> KIND_SHIFT;
}

function createPropertyValue(kind: number, width: number, shouldJoin = false): number {
  return ((kind & KIND_MASK) << KIND_SHIFT) | ((width & WIDTH_MASK) << WIDTH_SHIFT) | (shouldJoin ? 1 : 0);
}

function isInRanges(codepoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([start, end]) => codepoint >= start && codepoint <= end);
}

const EMOJI_VARIATION_BASE_RANGES = [
  [0x00a9, 0x00a9],
  [0x00ae, 0x00ae],
  [0x203c, 0x203c],
  [0x2049, 0x2049],
  [0x2122, 0x2122],
  [0x2139, 0x2139],
  [0x2194, 0x21aa],
  [0x231a, 0x231b],
  [0x2328, 0x2328],
  [0x23cf, 0x23cf],
  [0x23e9, 0x23f3],
  [0x23f8, 0x23fa],
  [0x24c2, 0x24c2],
  [0x25aa, 0x25ab],
  [0x25b6, 0x25b6],
  [0x25c0, 0x25c0],
  [0x25fb, 0x25fe],
  [0x2600, 0x27bf],
  [0x2934, 0x2935],
  [0x2b05, 0x2b55],
  [0x3030, 0x3030],
  [0x303d, 0x303d],
  [0x3297, 0x3297],
  [0x3299, 0x3299],
] as const;

const EMOJI_PRESENTATION_RANGES = [
  [0x1f000, 0x1f9ff],
  [0x1fa00, 0x1faff],
  [0x1fb00, 0x1fbff],
] as const;

function isEmojiVariationBase(codepoint: number): boolean {
  return isInRanges(codepoint, EMOJI_VARIATION_BASE_RANGES);
}

function isEmojiPresentationCodepoint(codepoint: number): boolean {
  return isInRanges(codepoint, EMOJI_PRESENTATION_RANGES) || isEmojiVariationBase(codepoint);
}

function isEmojiModifier(codepoint: number): boolean {
  return codepoint >= 0x1f3fb && codepoint <= 0x1f3ff;
}

function isEmojiJoinableKind(kind: number): boolean {
  return kind === KIND_EMOJI_CLUSTER || kind === KIND_EMOJI_VARIATION_BASE;
}

export function createCodeTabsUnicodeProvider(baseProvider: IUnicodeVersionProvider): IUnicodeVersionProvider {
  return {
    version: CODE_TABS_UNICODE_VERSION,
    wcwidth: (codepoint) => baseProvider.wcwidth(codepoint),
    charProperties(codepoint, preceding) {
      const baseProperties = baseProvider.charProperties(codepoint, preceding);
      const baseWidth = extractWidth(baseProperties);
      const precedingKind = extractKind(preceding);
      const precedingWidth = extractWidth(preceding);

      if (codepoint === 0xfe0f && precedingWidth > 0 && isEmojiJoinableKind(precedingKind)) {
        return createPropertyValue(KIND_EMOJI_CLUSTER, 2, true);
      }

      if (codepoint === 0x200d && precedingWidth > 0 && precedingKind === KIND_EMOJI_CLUSTER) {
        return createPropertyValue(KIND_EMOJI_ZWJ, precedingWidth, true);
      }

      if (precedingKind === KIND_EMOJI_ZWJ && isEmojiPresentationCodepoint(codepoint)) {
        return createPropertyValue(KIND_EMOJI_CLUSTER, precedingWidth || 2, true);
      }

      if (isEmojiModifier(codepoint) && precedingKind === KIND_EMOJI_CLUSTER) {
        return createPropertyValue(KIND_EMOJI_CLUSTER, precedingWidth || 2, true);
      }

      if (baseWidth === 2 && isEmojiPresentationCodepoint(codepoint)) {
        return createPropertyValue(KIND_EMOJI_CLUSTER, baseWidth, extractShouldJoin(baseProperties));
      }

      if (isEmojiVariationBase(codepoint)) {
        return createPropertyValue(KIND_EMOJI_VARIATION_BASE, baseWidth, extractShouldJoin(baseProperties));
      }

      return baseProperties;
    },
  };
}

export function measureUnicodeStringWidth(provider: IUnicodeVersionProvider, text: string): number {
  let width = 0;
  let preceding = 0;

  for (let index = 0; index < text.length; index++) {
    const codepoint = text.codePointAt(index);
    if (codepoint === undefined) continue;
    if (codepoint > 0xffff) index++;

    const properties = provider.charProperties(codepoint, preceding);
    let cellWidth = extractWidth(properties);
    if (extractShouldJoin(properties)) {
      cellWidth = Math.max(0, cellWidth - extractWidth(preceding)) as UnicodeCellWidth;
    }
    width += cellWidth;
    preceding = properties;
  }

  return width;
}

function inspectRuntimeUnicode(term: Pick<Terminal, "unicode">): RuntimeUnicodeApi {
  return term.unicode as RuntimeUnicodeApi;
}

function inspectRuntimeUnicodeService(term: Pick<Terminal, "unicode">): RuntimeUnicodeService {
  const unicode = inspectRuntimeUnicode(term);
  return unicode._core?.unicodeService ?? unicode;
}

function measureTerminalStringWidth(term: Pick<Terminal, "unicode">, text: string): number | null {
  const unicodeService = inspectRuntimeUnicodeService(term);
  if (typeof unicodeService.getStringCellWidth === "function") {
    return unicodeService.getStringCellWidth(text);
  }

  const activeProvider = unicodeService._activeProvider;
  if (activeProvider) {
    return measureUnicodeStringWidth(activeProvider, text);
  }

  return null;
}

export function inspectTerminalUnicode(term: Pick<Terminal, "unicode">): TerminalUnicodeDiagnostics {
  const unicode = inspectRuntimeUnicode(term);
  const probes = REQUIRED_WIDTH_PROBES.map((probe) => {
    const actual = measureTerminalStringWidth(term, probe.text);
    return {
      ...probe,
      actual,
      ok: actual === probe.expected,
    };
  });

  return {
    activeVersion: unicode.activeVersion,
    versions: [...unicode.versions],
    probes,
  };
}

function summarizeFailedProbes(diagnostics: TerminalUnicodeDiagnostics): string {
  return diagnostics.probes
    .filter((probe) => !probe.ok)
    .map((probe) => `${probe.label}: expected ${probe.expected}, got ${probe.actual ?? "unknown"}`)
    .join("; ");
}

export function activateTerminalUnicodeProvider(
  term: Pick<Terminal, "unicode" | "loadAddon">,
  options: ActivateTerminalUnicodeOptions = {},
): { addon: TerminalUnicodeAddon; diagnostics: TerminalUnicodeDiagnostics } {
  const addon = options.addonFactory?.() ?? new Unicode11Addon();

  try {
    term.loadAddon(addon);
    term.unicode.activeVersion = "11";
  } catch (error) {
    throw new TerminalUnicodeActivationError(
      "Failed to activate xterm Unicode 11 provider",
      inspectTerminalUnicode(term),
      error,
    );
  }

  const unicode = inspectRuntimeUnicode(term);
  const unicodeService = inspectRuntimeUnicodeService(term);
  const baseProvider = unicodeService._activeProvider;
  if (!baseProvider || unicode.activeVersion !== "11") {
    throw new TerminalUnicodeActivationError(
      "xterm Unicode 11 provider did not become active",
      inspectTerminalUnicode(term),
    );
  }

  try {
    unicode.register(createCodeTabsUnicodeProvider(baseProvider));
    unicode.activeVersion = CODE_TABS_UNICODE_VERSION;
  } catch (error) {
    throw new TerminalUnicodeActivationError(
      "Failed to activate Code Tabs emoji-aware Unicode provider",
      inspectTerminalUnicode(term),
      error,
    );
  }

  const diagnostics = inspectTerminalUnicode(term);
  const failedProbes = diagnostics.probes.filter((probe) => !probe.ok);
  if (failedProbes.length > 0) {
    throw new TerminalUnicodeActivationError(
      `Terminal Unicode provider failed width probes: ${summarizeFailedProbes(diagnostics)}`,
      diagnostics,
    );
  }

  return { addon, diagnostics };
}

export function serializeTerminalUnicodeError(error: unknown): Record<string, unknown> {
  if (error instanceof TerminalUnicodeActivationError) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error ? {
        name: error.cause.name,
        message: error.cause.message,
        stack: error.cause.stack,
      } : String(error.cause),
      diagnostics: error.diagnostics,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}
