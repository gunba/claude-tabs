import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "../store/settings";
import { useVersionStore } from "../store/version";

export function useWindowTitle(): void {
  const appVersion = useVersionStore((s) => s.appVersion);
  const cliVersions = useSettingsStore((s) => s.cliVersions);

  useEffect(() => {
    const parts = ["Code Tabs"];
    if (appVersion) parts[0] += ` v${appVersion}`;
    parts.push(`Claude ${cliVersions.claude ?? "not installed"}`);
    parts.push(`Codex ${cliVersions.codex ?? "not installed"}`);
    getCurrentWindow().setTitle(parts.join(" · ")).catch(() => {});
  }, [appVersion, cliVersions]);
}
