import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parseGitStatus, detectChangedPaths } from "../lib/diffParser";
import type { GitStatusData, GitStatusRaw } from "../types/git";

const POLL_INTERVAL = 2000;
const ANIMATION_DURATION = 1000;

export interface GitStatusHook {
  isGitRepo: boolean;
  status: GitStatusData | null;
  error: string | null;
  changedPaths: Set<string>;
}

export function useGitStatus(
  workingDir: string | null,
  enabled: boolean,
): GitStatusHook {
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [status, setStatus] = useState<GitStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changedPaths, setChangedPaths] = useState<Set<string>>(new Set());
  const prevStatusRef = useRef<GitStatusData | null>(null);
  const cancelledRef = useRef(false);

  // Check if directory is a git repo (once per workingDir change)
  useEffect(() => {
    setIsGitRepo(false);
    setStatus(null);
    setError(null);
    setChangedPaths(new Set());
    prevStatusRef.current = null;

    if (!workingDir || !enabled) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await invoke<boolean>("git_repo_check", { workingDir });
        if (!cancelled) setIsGitRepo(result);
      } catch {
        if (!cancelled) setIsGitRepo(false);
      }
    })();

    return () => { cancelled = true; };
  }, [workingDir, enabled]);

  // Poll git status every 2s (setTimeout-after-await, no overlap)
  useEffect(() => {
    if (!workingDir || !enabled || !isGitRepo) return;

    cancelledRef.current = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelledRef.current) return;
      try {
        const raw = await invoke<GitStatusRaw>("git_status", { workingDir });
        if (cancelledRef.current) return;

        const parsed = parseGitStatus(raw.porcelain, raw.numstat, raw.numstatStaged);
        const changed = detectChangedPaths(prevStatusRef.current, parsed);

        prevStatusRef.current = parsed;
        setStatus(parsed);
        setError(null);

        if (changed.size > 0) {
          setChangedPaths(changed);
          setTimeout(() => {
            if (!cancelledRef.current) setChangedPaths(new Set());
          }, ANIMATION_DURATION);
        }
      } catch (err) {
        if (!cancelledRef.current) setError(String(err));
      }

      if (!cancelledRef.current) {
        timeoutId = setTimeout(poll, POLL_INTERVAL);
      }
    }

    poll();

    return () => {
      cancelledRef.current = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [workingDir, enabled, isGitRepo]);

  return { isGitRepo, status, error, changedPaths };
}
