import { describe, expect, it } from "vitest";
import type { ModelProvider, ProviderModel } from "../../types/session";
import {
  OPENAI_CODEX_CONTEXT_WINDOW,
  buildOpenAICodexMappings,
  buildOpenAICodexModels,
} from "../../types/session";
import {
  getAutoCompactThreshold,
  getLaunchEnvForProvider,
  getLaunchModelForProvider,
  getProviderContextWindow,
} from "../providerLaunch";

const openAiProvider: ModelProvider = {
  id: "openai-codex",
  name: "OpenAI",
  kind: "openai_codex",
  predefined: true,
  codexPrimaryModel: "gpt-5.5",
  codexSmallModel: "gpt-5.5-mini",
  knownModels: buildOpenAICodexModels(),
  modelMappings: buildOpenAICodexMappings(),
};

const anthropicCatalog: ProviderModel[] = [
  { id: "opus[1m]", label: "opus[1m]", family: "opus", contextWindow: 1000000 },
  { id: "sonnet[1m]", label: "sonnet[1m]", family: "sonnet", contextWindow: 1000000 },
];

describe("providerLaunch", () => {
  it("resolves OpenAI context from the matched provider mapping", () => {
    expect(getProviderContextWindow(openAiProvider, "haiku")).toBe(OPENAI_CODEX_CONTEXT_WINDOW);
    expect(getProviderContextWindow(openAiProvider, "best")).toBe(OPENAI_CODEX_CONTEXT_WINDOW);
    expect(getProviderContextWindow(openAiProvider, "claude-opus-4-6")).toBe(OPENAI_CODEX_CONTEXT_WINDOW);
  });

  it("promotes OpenAI launch models into a 1m variant for larger provider windows", () => {
    expect(getLaunchModelForProvider("best", openAiProvider, anthropicCatalog)).toBe("opus[1m]");
    expect(getLaunchModelForProvider("haiku", openAiProvider, anthropicCatalog)).toBe("sonnet[1m]");
    expect(getLaunchModelForProvider("best[1m]", openAiProvider, anthropicCatalog)).toBe("opus[1m]");
    expect(getLaunchModelForProvider("gpt-5.5", openAiProvider, anthropicCatalog)).toBe("opus[1m]");
    expect(getLaunchModelForProvider("gpt-5.5-mini", openAiProvider, anthropicCatalog)).toBe("sonnet[1m]");
  });

  it("falls back cleanly when the live carrier catalog changes shape", () => {
    const catalog: ProviderModel[] = [
      { id: "mythos[1m]", label: "mythos[1m]", family: "mythos", contextWindow: 1000000 },
    ];

    expect(getLaunchModelForProvider("gpt-5.5", openAiProvider, catalog)).toBe("mythos[1m]");
  });

  it("sets the autocompact window env for OpenAI launches", () => {
    expect(getLaunchEnvForProvider(openAiProvider, "best")).toEqual({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(OPENAI_CODEX_CONTEXT_WINDOW),
    });
  });

  it("keeps Anthropic launches unchanged", () => {
    const anthropicProvider: ModelProvider = {
      id: "anthropic",
      name: "Anthropic",
      kind: "anthropic_compatible",
      predefined: false,
      knownModels: [],
      modelMappings: [],
      baseUrl: "https://api.anthropic.com",
      apiKey: null,
    };

    expect(getProviderContextWindow(anthropicProvider, "best")).toBeNull();
    expect(getLaunchModelForProvider("best", anthropicProvider)).toBe("best");
    expect(getLaunchEnvForProvider(anthropicProvider, "best")).toEqual({});
  });

  it("uses the same flat 33k overhead for a 272k window", () => {
    expect(getAutoCompactThreshold(OPENAI_CODEX_CONTEXT_WINDOW)).toBe(239000);
  });
});
