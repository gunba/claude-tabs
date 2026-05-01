import { canonicalizePath } from "./paths";
import type { FileChangeKind } from "../types/activity";

export interface CodexParsedCommandActivity {
  path: string;
  kind: FileChangeKind;
  isFolder: boolean;
}

function isAbsoluteLikePath(path: string): boolean {
  return path.startsWith("/")
    || path.startsWith("~")
    || /^[A-Za-z]:[\\/]/.test(path);
}

function resolveParsedPath(rawPath: string, cwd: string): string {
  if (!rawPath) return "";
  if (isAbsoluteLikePath(rawPath) || !cwd) return canonicalizePath(rawPath);
  return canonicalizePath(`${cwd.replace(/[\\/]+$/, "")}/${rawPath}`);
}

// [CP-02] Codex parsed_cmd telemetry feeds file activity without re-tokenizing shell commands.
export function codexParsedCommandActivities(
  parsedCmd: Array<Record<string, unknown>> | null | undefined,
  cwd: string,
): CodexParsedCommandActivity[] {
  if (!parsedCmd || parsedCmd.length === 0) return [];
  const activities: CodexParsedCommandActivity[] = [];
  for (const cmd of parsedCmd) {
    const type = typeof cmd.type === "string" ? cmd.type : "";
    const rawPath = typeof cmd.path === "string" && cmd.path.trim()
      ? cmd.path
      : cwd;
    if (!rawPath) continue;
    if (type === "read") {
      activities.push({
        path: resolveParsedPath(rawPath, cwd),
        kind: "read",
        isFolder: false,
      });
    } else if (type === "list_files" || type === "search") {
      activities.push({
        path: resolveParsedPath(rawPath, cwd),
        kind: "searched",
        isFolder: true,
      });
    }
  }
  return activities;
}
