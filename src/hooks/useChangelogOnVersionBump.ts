import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useSettingsStore } from "../store/settings";
import type { CliKind } from "../types/session";
import { isCliVersionIncrease, type ChangelogRequest } from "../lib/changelog";

export function useChangelogOnVersionBump({
  changelogRequest,
  setChangelogRequest,
}: {
  changelogRequest: ChangelogRequest | null;
  setChangelogRequest: Dispatch<SetStateAction<ChangelogRequest | null>>;
}): void {
  const cliVersions = useSettingsStore((s) => s.cliVersions);
  const lastOpenedCliVersions = useSettingsStore((s) => s.lastOpenedCliVersions);
  const setLastOpenedCliVersion = useSettingsStore((s) => s.setLastOpenedCliVersion);
  const handledCliVersionRef = useRef<Partial<Record<CliKind, string>>>({});

  useEffect(() => {
    const ranges: ChangelogRequest["ranges"] = {};
    for (const cli of ["claude", "codex"] as const) {
      const current = cliVersions[cli];
      if (!current) continue;
      if (handledCliVersionRef.current[cli] === current) continue;
      handledCliVersionRef.current[cli] = current;

      const previous = lastOpenedCliVersions[cli];
      if (previous && isCliVersionIncrease(current, previous)) {
        ranges[cli] = { fromVersion: previous, toVersion: current };
      }
      if (previous !== current) {
        setLastOpenedCliVersion(cli, current);
      }
    }

    const changedCli = (["claude", "codex"] as const).find((cli) => ranges[cli]);
    if (changedCli && !changelogRequest) {
      setChangelogRequest({
        kind: "startup",
        initialCli: changedCli,
        ranges,
      });
    }
  }, [changelogRequest, cliVersions, lastOpenedCliVersions, setChangelogRequest, setLastOpenedCliVersion]);
}
