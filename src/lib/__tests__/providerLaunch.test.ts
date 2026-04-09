import { describe, expect, it } from "vitest";
import type { ModelProvider } from "../../types/session";
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
  codexPrimaryModel: "gpt-5.4",
  codexSmallModel: "gpt-5.4-mini",
  knownModels: buildOpenAICodexModels(),
  modelMappings: buildOpenAICodexMappings(),
};

describe("providerLaunch", () => {
  it("resolves OpenAI context from the matched provider mapping", () => {
    expect(getProviderContextWindow(openAiProvider, "haiku")).toBe(OPENAI_CODEX_CONTEXT_WINDOW);
    expect(getProviderContextWindow(openAiProvider, "best")).toBe(OPENAI_CODEX_CONTEXT_WINDOW);
    expect(getProviderContextWindow(openAiProvider, "claude-opus-4-6")).toBe(OPENAI_CODEX_CONTEXT_WINDOW);
  });

  it("promotes OpenAI launch models into a 1m variant for larger provider windows", () => {
    expect(getLaunchModelForProvider("best", openAiProvider)).toBe("best[1m]");
    expect(getLaunchModelForProvider("haiku", openAiProvider)).toBe("haiku[1m]");
    expect(getLaunchModelForProvider("best[1m]", openAiProvider)).toBe("best[1m]");
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
