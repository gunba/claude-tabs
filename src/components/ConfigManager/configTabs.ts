import type { CliKind } from "../../types/session";

export type ConfigManagerTab =
  | "settings"
  | "envvars"
  | "claudemd"
  | "hooks"
  | "plugins"
  | "mcp"
  | "agents"
  | "prompts"
  | "skills"
  | "recording";

export interface ConfigTabVisibilityContext {
  configCli: CliKind;
  debugBuild: boolean;
}

export function isConfigTabVisible(
  tabId: ConfigManagerTab,
  { configCli, debugBuild }: ConfigTabVisibilityContext,
): boolean {
  if (!debugBuild && tabId === "recording") return false;
  if (configCli === "codex") {
    return tabId !== "agents";
  }
  return true;
}

export function visibleConfigTabs<T extends { id: ConfigManagerTab }>(
  tabs: T[],
  context: ConfigTabVisibilityContext,
): T[] {
  return tabs.filter((tab) => isConfigTabVisible(tab.id, context));
}
