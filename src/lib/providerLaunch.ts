import type { ModelMapping, ModelProvider } from "../types/session";

// [PR-07] OpenAI Codex launches lift Claude Code's compact window to the
// provider-sized context while keeping the same flat headroom.
const CLAUDE_CODE_DEFAULT_CONTEXT_WINDOW = 200000;
const CLAUDE_CODE_CONTEXT_SUFFIX = "[1m]";
const CLAUDE_CODE_OUTPUT_RESERVE = 20000;
const CLAUDE_CODE_COMPACT_BUFFER = 13000;

function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
}

function mappingMatchesModel(mapping: ModelMapping, model: string): boolean {
  return globPatternToRegExp(mapping.pattern).test(model);
}

export function getProviderContextWindow(
  provider: ModelProvider | null | undefined,
  model: string | null,
): number | null {
  if (!provider) return null;

  if (model) {
    const mapping = provider.modelMappings.find(
      (entry) => typeof entry.contextWindow === "number" && entry.contextWindow > 0 && mappingMatchesModel(entry, model),
    );
    if (mapping?.contextWindow) return mapping.contextWindow;
  }

  const knownWindows = provider.knownModels
    .map((entry) => entry.contextWindow)
    .filter((value): value is number => typeof value === "number" && value > 0);
  if (knownWindows.length > 0) return Math.max(...knownWindows);

  return null;
}

export function getLaunchModelForProvider(
  model: string | null,
  provider: ModelProvider | null | undefined,
): string | null {
  if (!model || provider?.kind !== "openai_codex") return model;

  const contextWindow = getProviderContextWindow(provider, model);
  if (!contextWindow || contextWindow <= CLAUDE_CODE_DEFAULT_CONTEXT_WINDOW) return model;
  if (model.includes(CLAUDE_CODE_CONTEXT_SUFFIX)) return model;

  return `${model}${CLAUDE_CODE_CONTEXT_SUFFIX}`;
}

export function getLaunchEnvForProvider(
  provider: ModelProvider | null | undefined,
  model: string | null,
): Record<string, string> {
  if (provider?.kind !== "openai_codex") return {};

  const contextWindow = getProviderContextWindow(provider, model);
  if (!contextWindow || contextWindow <= CLAUDE_CODE_DEFAULT_CONTEXT_WINDOW) return {};

  return {
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(contextWindow),
  };
}

export function getAutoCompactThreshold(contextWindow: number): number {
  return Math.max(
    0,
    contextWindow - CLAUDE_CODE_OUTPUT_RESERVE - CLAUDE_CODE_COMPACT_BUFFER,
  );
}
