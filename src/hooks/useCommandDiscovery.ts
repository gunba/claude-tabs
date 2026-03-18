import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessions";
import { useSettingsStore } from "../store/settings";
import { trace, traceAsync } from "../lib/perfTrace";
import type { SlashCommand } from "../store/settings";

function mergeCommands(...lists: SlashCommand[][]): SlashCommand[] {
  const map = new Map<string, SlashCommand>();
  for (const list of lists) {
    for (const cmd of list) {
      const existing = map.get(cmd.cmd);
      if (!existing || (cmd.desc && cmd.desc.length > (existing.desc?.length ?? 0))) {
        map.set(cmd.cmd, cmd);
      }
    }
  }
  return Array.from(map.values());
}

// Discovers slash commands from Claude Code binary + plugin/project directory scans.
export function useCommandDiscovery(): void {
  const discoveredRef = useRef(false);
  const claudePath = useSessionStore((s) => s.claudePath);

  useEffect(() => {
    if (discoveredRef.current || !claudePath) return;
    discoveredRef.current = true;

    // Defer so the UI is interactive before scanning the binary
    const timer = setTimeout(() => discover(), 1000);
    return () => clearTimeout(timer);

    async function discover() {
      trace("commandDiscovery: start");
      const sessions = useSessionStore.getState().sessions;
      const recentDirs = useSettingsStore.getState().recentDirs;
      const projectDirs = [
        ...new Set([
          ...sessions.map((s) => s.config.workingDir).filter(Boolean),
          ...recentDirs,
        ]),
      ];

      const builtinPromise = traceAsync("commandDiscovery: discover_builtin_commands", () =>
        invoke<Array<{ cmd: string; desc: string }>>("discover_builtin_commands")
      ).catch(() => [] as Array<{ cmd: string; desc: string }>);

      const pluginPromise = traceAsync("commandDiscovery: discover_plugin_commands", () =>
        invoke<Array<{ cmd: string; desc: string }>>("discover_plugin_commands", { extraDirs: projectDirs })
      ).catch(() => [] as Array<{ cmd: string; desc: string }>);

      // Fallback: parse --help output for slash commands when binary scan fails
      // (binary may not exist on machines without admin or on first install)
      const helpPromise = traceAsync("commandDiscovery: get_cli_help", () =>
        invoke<string>("get_cli_help")
      ).then((help) => {
        const cmds: Array<{ cmd: string; desc: string }> = [];
        // Match lines like "  /command    Description text"
        const re = /^\s+(\/[\w-]+)\s{2,}(.+)$/gm;
        let m;
        while ((m = re.exec(help)) !== null) {
          cmds.push({ cmd: m[1], desc: m[2].trim() });
        }
        return cmds;
      }).catch(() => [] as Array<{ cmd: string; desc: string }>);

      const [builtins, plugins, helpCmds] = await Promise.all([builtinPromise, pluginPromise, helpPromise]);

      const toSlash = (arr: Array<{ cmd: string; desc: string }>): SlashCommand[] =>
        arr.filter((c) => typeof c.cmd === "string" && c.cmd.startsWith("/"));

      // Merge all sources — binary scan has best descriptions, --help is fallback
      const merged = mergeCommands(toSlash(builtins), toSlash(helpCmds), toSlash(plugins));
      useSettingsStore.getState().setSlashCommands(merged);
    }
  }, [claudePath]);
}
