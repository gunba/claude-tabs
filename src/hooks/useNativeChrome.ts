import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_LINUX } from "../lib/paths";

export function useNativeChrome(): boolean {
  const [useNativeChrome, setUseNativeChrome] = useState(false);

  // [PL-01] Linux custom titlebar: tauri.conf.json sets decorations:false globally so non-KDE
  // Wayland compositors honor it at window creation. Non-Linux re-enables native decorations
  // at runtime. KDE+Wayland is a known upstream Tauri bug (issues #6162/#6562 — KWin ignores
  // decorations:false from wry's GTK-Wayland window), so on that combo we restore native
  // decorations and skip our custom Header to avoid a duplicated titlebar.
  useEffect(() => {
    (async () => {
      const native = IS_LINUX ? await invoke<boolean>("linux_use_native_chrome").catch(() => false) : true;
      setUseNativeChrome(native);
      if (native) {
        await getCurrentWindow().setDecorations(true).catch(() => {});
      }
    })();
  }, []);

  return useNativeChrome;
}
