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
].map((id) => ({ id: id as ConfigManagerTab }));

function visibleIds(configCli: "claude" | "codex", debugBuild: boolean): ConfigManagerTab[] {
  return visibleConfigTabs(tabs, { configCli, debugBuild }).map((tab) => tab.id);
}

describe("visibleConfigTabs", () => {
  it("hides Observability outside debug builds", () => {
    expect(visibleIds("claude", false)).not.toContain("recording");
    expect(visibleIds("codex", false)).not.toContain("recording");
  });

  it("shows Observability in debug builds", () => {
    expect(visibleIds("claude", true)).toContain("recording");
    expect(visibleIds("codex", true)).toContain("recording");
  });

  it("keeps Codex-specific tab filtering independent from debug gating", () => {
    expect(visibleIds("codex", true)).not.toContain("agents");
    expect(visibleIds("claude", true)).toContain("agents");
  });
});
