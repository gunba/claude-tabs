import { ANTHROPIC_MODELS, type ModelMapping, type ModelProvider, type ProviderModel } from "../types/session";

// [PR-07] OpenAI Codex launches lift Claude Code's compact window to the
// provider-sized context while keeping the same flat headroom.
const CLAUDE_CODE_DEFAULT_CONTEXT_WINDOW = 200000;
const CLAUDE_CODE_OUTPUT_RESERVE = 20000;
const CLAUDE_CODE_COMPACT_BUFFER = 13000;

function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
}

function mappingMatchesModel(mapping: ModelMapping, model: string): boolean {
  return globPatternToRegExp(mapping.pattern).test(model);
}

function equalsIgnoreCase(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function resolveMappedProviderModel(model: string, provider: ModelProvider): string {
  const mapped = provider.modelMappings.find(
    (entry) => !!entry.rewriteModel && mappingMatchesModel(entry, model),
  )?.rewriteModel;
  return mapped && mapped.length > 0 ? mapped : model;
}

function preferredCarrierFamilies(model: string, provider: ModelProvider): string[] {
  const lower = model.toLowerCase();
  if (provider.codexSmallModel && equalsIgnoreCase(model, provider.codexSmallModel)) {
    return ["sonnet", "opus"];
  }
  if (provider.codexPrimaryModel && equalsIgnoreCase(model, provider.codexPrimaryModel)) {
    return ["opus", "sonnet"];
  }
  if (lower.includes("haiku")) return ["sonnet", "opus"];
  if (lower.includes("sonnet")) return ["sonnet", "opus"];
  if (lower.includes("best") || lower.includes("opusplan") || lower.includes("opus")) {
    return ["opus", "sonnet"];
  }

  const mappedModel = resolveMappedProviderModel(model, provider);
  if (provider.codexSmallModel && equalsIgnoreCase(mappedModel, provider.codexSmallModel)) {
    return ["sonnet", "opus"];
  }
  if (provider.codexPrimaryModel && equalsIgnoreCase(mappedModel, provider.codexPrimaryModel)) {
    return ["opus", "sonnet"];
  }

  return ["opus", "sonnet"];
}

function resolveCarrierCatalog(carrierCatalog?: ProviderModel[] | null): ProviderModel[] {
  const catalog = carrierCatalog?.length ? carrierCatalog : ANTHROPIC_MODELS;
  return catalog.filter((entry) => (entry.contextWindow ?? 0) > CLAUDE_CODE_DEFAULT_CONTEXT_WINDOW);
}

// [PR-08] OpenAI Codex launches use a Claude-native long-context carrier model
// from the live Anthropic model catalog instead of appending synthetic [1m]
// tags to arbitrary aliases that Claude Code may canonicalize away.
function resolveLongContextCarrierModel(
  model: string,
  provider: ModelProvider,
  carrierCatalog?: ProviderModel[] | null,
): string | null {
  const carriers = resolveCarrierCatalog(carrierCatalog);
  if (carriers.length === 0) return null;

  const exact = carriers.find((entry) => equalsIgnoreCase(entry.id, model));
  if (exact) return exact.id;

  for (const family of preferredCarrierFamilies(model, provider)) {
    const carrier = carriers.find((entry) => entry.family === family);
    if (carrier) return carrier.id;
  }

  return carriers[0]?.id ?? null;
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
  carrierCatalog?: ProviderModel[] | null,
): string | null {
  if (!model || provider?.kind !== "openai_codex") return model;

  const contextWindow = getProviderContextWindow(provider, model);
  if (!contextWindow || contextWindow <= CLAUDE_CODE_DEFAULT_CONTEXT_WINDOW) return model;

  return resolveLongContextCarrierModel(model, provider, carrierCatalog) ?? model;
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
