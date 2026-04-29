import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../store/settings";
import { useVersionStore } from "../store/version";
import { useWeatherStore } from "../store/weather";
import { useUiConfigStore } from "../lib/uiConfig";

export function useStartupBootstrap({
  init,
  loadRuntimeInfo,
}: {
  init: () => Promise<void>;
  loadRuntimeInfo: () => Promise<void>;
}): void {
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void (async () => {
      await loadRuntimeInfo();
      await init();

      const settings = useSettingsStore.getState();
      const version = useVersionStore.getState();

      useUiConfigStore.getState().loadConfig();
      settings.loadPastSessions();
      settings.pruneRecentDirs();
      invoke("migrate_legacy_data").catch(() => {});
      // [HM-11] Startup intentionally does not install or mutate Claude hook
      // settings; hook changes are user-managed via the Hooks UI only.
      invoke("cleanup_session_data", { maxAgeHours: 72 }).catch(() => {});
      version.loadBuildInfo();
      version.checkForAppUpdate();
      version.checkLatestCliVersion();
      // [WX-01] Hydrate ambient-viz weather from cache + subscribe to updates.
      // Send the user's IANA timezone so the backend resolves to a city
      // (e.g. Australia/Perth → Perth) rather than the country capital.
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) invoke("set_user_timezone", { tz }).catch(() => {});
      } catch {
        // Old runtime without Intl support; backend falls back to country code.
      }
      void useWeatherStore.getState().init();
    })();
  }, [init, loadRuntimeInfo]);
}
