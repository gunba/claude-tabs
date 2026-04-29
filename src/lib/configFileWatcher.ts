import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

export interface ConfigFileWatchTarget {
  scope: string;
  workingDir: string;
  fileType: string;
}

export interface ConfigFileChangedPayload extends ConfigFileWatchTarget {
  watchId: string;
  path: string;
}

export function useConfigFileWatcher(
  target: ConfigFileWatchTarget | null | undefined,
  onChange: (payload: ConfigFileChangedPayload) => void,
): void {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!target) return;

    let disposed = false;
    let watchId: string | null = null;
    let unlisten: (() => void) | null = null;

    const stop = (id: string) => {
      void invoke("stop_watching_config_file", { watchId: id }).catch(() => {});
    };

    listen<ConfigFileChangedPayload>("config_file_changed", (event) => {
      if (disposed || event.payload.watchId !== watchId) return;
      onChangeRef.current(event.payload);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
      invoke<string>("watch_config_file", {
        scope: target.scope,
        workingDir: target.workingDir,
        fileType: target.fileType,
      }).then((id) => {
        if (disposed) stop(id);
        else watchId = id;
      }).catch(() => {});
    }).catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
      if (watchId) stop(watchId);
    };
  }, [target?.scope, target?.workingDir, target?.fileType]);
}
