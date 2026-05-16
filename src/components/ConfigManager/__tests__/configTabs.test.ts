import { describe, expect, it } from "vitest";
import { visibleConfigTabs, type ConfigManagerTab } from "../configTabs";

const tabs = [
  "settings",
  "envvars",
  "claudemd",
  "hooks",
  "plugins",
  "mcp",
  "agents",
  "prompts",
  "skills",
  "recording",
  "app",
].map((id) => ({ id: id as ConfigManagerTab }));

function visibleIds(configCli: "claude" | "codex"): ConfigManagerTab[] {
  return visibleConfigTabs(tabs, { configCli }).map((tab) => tab.id);
}

describe("visibleConfigTabs", () => {
  it("always shows the Observability tab", () => {
    expect(visibleIds("claude")).toContain("recording");
    expect(visibleIds("codex")).toContain("recording");
  });

  it("always shows the App tab", () => {
    expect(visibleIds("claude")).toContain("app");
    expect(visibleIds("codex")).toContain("app");
  });

  it("hides Claude-only tabs when Codex is the active CLI", () => {
    expect(visibleIds("codex")).not.toContain("agents");
    expect(visibleIds("claude")).toContain("agents");
  });
});
