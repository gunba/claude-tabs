import { invoke } from "@tauri-apps/api/core";
import { useActivityStore } from "../store/activity";
import { useSessionStore } from "../store/sessions";
import { dlog } from "../lib/debugLog";
import { canonicalizePath, normalizePath } from "../lib/paths";
import { parseBashFiles } from "../lib/bashFileParser";
import { codexParsedCommandActivities } from "../lib/codexParsedCommandActivity";
import type { TapEvent } from "../types/tapEvents";
import type { ToolInputDiffData, FileChangeKind } from "../types/activity";
import type { TapSubagentTracker } from "../lib/tapSubagentTracker";

interface GitChange { path: string; status: string }
interface PathStatus { path: string; exists: boolean; isDir: boolean }

function gitStatusToKind(status: string): FileChangeKind {
  if (status === "D") return "deleted";
  if (status === "A" || status === "?") return "created";
  return "modified";
}

// [CP-01] parseApplyPatchFiles: parses '*** (Add|Update|Delete) File: ...' markers from apply_patch input; feeds activityStore.addFileActivity per matched path
function parseApplyPatchFiles(patch: string, workDir: string): Array<{ path: string; kind: FileChangeKind }> {
  const files: Array<{ path: string; kind: FileChangeKind }> = [];
  for (const line of patch.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (!match) continue;
    const rawPath = match[2].trim();
    const absolute =
      /^[A-Za-z]:[\\/]/.test(rawPath) || rawPath.startsWith("/") || rawPath.startsWith("~");
    const path = absolute || !workDir ? rawPath : `${workDir.replace(/[\\/]+$/, "")}/${rawPath}`;
    files.push({
      path: canonicalizePath(path),
      kind: match[1] === "Add" ? "created" : match[1] === "Delete" ? "deleted" : "modified",
    });
  }
  return files;
}

export async function runPathExistenceValidation(sid: string): Promise<void> {
  const activity = useActivityStore.getState().sessions[sid];
  if (!activity) return;
  const paths = new Set<string>();
  for (const f of Object.values(activity.allFiles)) paths.add(f.path);
  for (const turn of activity.turns) {
    for (const f of turn.files) paths.add(f.path);
  }
  if (paths.size === 0) return;
  try {
    const results = await invoke<PathStatus[]>("paths_exist", { paths: [...paths] });
    useActivityStore.getState().confirmEntries(sid, results);
  } catch (err) {
    dlog("tap", sid, `paths_exist failed: ${err}`, "DEBUG");
  }
}

export async function runGitScanAndValidate(sid: string): Promise<void> {
  const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
  const workDir = session?.config.workingDir ?? "";
  const activityStore = useActivityStore.getState();

  if (workDir) {
    try {
      const changes = await invoke<GitChange[]>("git_list_changes", { workingDir: workDir });
      const known = activityStore.sessions[sid]?.visitedPaths ?? new Set<string>();
      for (const change of changes) {
        const canonical = canonicalizePath(change.path);
        if (known.has(canonical)) continue;
        activityStore.addFileActivity(sid, canonical, gitStatusToKind(change.status), {
          agentId: null,
          toolName: "git",
          isExternal: false,
        });
      }
    } catch (err) {
      dlog("tap", sid, `git_list_changes failed: ${err}`, "DEBUG");
    }
  }

  await runPathExistenceValidation(sid);
}

function isAbsoluteLikePath(path: string): boolean {
  return path.startsWith("/")
    || path.startsWith("~")
    || /^[A-Za-z]:[\\/]/.test(path);
}

function resolveActivityPath(rawPath: string, workDir: string): string {
  if (!rawPath) return "";
  if (isAbsoluteLikePath(rawPath) || !workDir) return canonicalizePath(rawPath);
  return canonicalizePath(`${workDir.replace(/[\\/]+$/, "")}/${rawPath}`);
}

function isExternalActivityPath(path: string, workDir: string): boolean {
  const normalizedWorkDir = normalizePath(workDir);
  return normalizedWorkDir ? !normalizePath(path).startsWith(normalizedWorkDir) : false;
}

function recordContextPath(
  sid: string,
  rawPath: string,
  memoryType: string,
  loadReason: string,
  toolName: string,
  agentId: string | null
): void {
  if (!rawPath.trim()) return;
  const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
  const workDir = session?.config.workingDir ?? "";
  const ctxPath = resolveActivityPath(rawPath, workDir);
  const isExternal = isExternalActivityPath(ctxPath, workDir);
  const activityStore = useActivityStore.getState();
  activityStore.addContextFile(sid, {
    path: ctxPath,
    memoryType,
    loadReason,
  });
  activityStore.addFileActivity(sid, ctxPath, "read", {
    agentId,
    toolName,
    isExternal,
  });
}

async function resolveAndRecordSkillFile(
  sid: string,
  skillName: string,
  agentId: string | null,
  seen: Set<string>
): Promise<void> {
  const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
  if (!session) return;
  const key = `${sid}:skill:${session.config.cli}:${skillName}`;
  if (seen.has(key)) return;
  seen.add(key);
  try {
    const path = await invoke<string | null>("resolve_skill_file", {
      cli: session.config.cli,
      skillName,
      workingDir: session.config.workingDir,
    });
    if (path) {
      recordContextPath(sid, path, "skill", skillName, "Skill", agentId);
    }
  } catch (err) {
    dlog("tap", sid, `resolve_skill_file failed: ${err}`, "DEBUG");
  }
}

async function resolveAndRecordContextFiles(
  sid: string,
  contextKind: "mcp" | "plugin" | "config" | "rules",
  label: string,
  toolName: string,
  agentId: string | null,
  seen: Set<string>
): Promise<void> {
  const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
  if (!session) return;
  const keyLabel = contextKind === "mcp" || contextKind === "config" ? contextKind : label;
  const key = `${sid}:context:${session.config.cli}:${contextKind}:${keyLabel}`;
  if (seen.has(key)) return;
  seen.add(key);
  try {
    const paths = await invoke<string[]>("resolve_activity_context_files", {
      cli: session.config.cli,
      contextKind,
      workingDir: session.config.workingDir,
    });
    for (const path of paths) {
      recordContextPath(sid, path, contextKind, label || contextKind, toolName, agentId);
    }
  } catch (err) {
    dlog("tap", sid, `resolve_activity_context_files failed: ${err}`, "DEBUG");
  }
}

export interface TapActivityTracker {
  endTurn: () => void;
  handleEvent: (event: TapEvent, subTracker: TapSubagentTracker) => void;
  markUserMessage: (display: string) => boolean;
}

export function createTapActivityTracker(sid: string): TapActivityTracker {
  let activityTurnCounter = 0;
  let activityTurnOpen = false;
  let lastActivityPromptDisplay: string | null = null;
  const contextFileHintsSeen = new Set<string>();

  const startActivityTurn = (promptDisplay: string | null): void => {
    if (activityTurnOpen) {
      if (promptDisplay) lastActivityPromptDisplay = promptDisplay;
      return;
    }
    activityTurnCounter++;
    useActivityStore.getState().startTurn(sid, `turn-${activityTurnCounter}`);
    activityTurnOpen = true;
    lastActivityPromptDisplay = promptDisplay;
  };

  const markUserMessage = (display: string): boolean => {
    const duplicateOpenPrompt = activityTurnOpen && lastActivityPromptDisplay === display;
    if (duplicateOpenPrompt) return false;
    startActivityTurn(display);
    return true;
  };

  const endTurn = (): void => {
    useActivityStore.getState().endTurn(sid);
    activityTurnOpen = false;
  };

  const handleEvent = (event: TapEvent, subTracker: TapSubagentTracker): void => {
    const activityStore = useActivityStore.getState();
    const isSidechain = subTracker.isSidechainActive?.() ?? false;
    const agentId = isSidechain ? (subTracker.getLastActiveAgentId?.() ?? null) : null;

    if ((event.kind === "TurnStart" || event.kind === "CodexTaskStarted") && !isSidechain) {
      startActivityTurn(null);
    }

    // endTurn is driven by settled-state, not TurnEnd, so it only fires when
    // all work is genuinely done (including subagents).

    if (event.kind === "SkillInvocation") {
      dlog("tap", sid, `skill invoked: ${event.skill} (success=${event.success})`, "DEBUG");
      useSessionStore.getState().addSkillInvocation(sid, {
        id: `skill-${event.ts}-${event.skill}`,
        skill: event.skill,
        success: event.success,
        allowedTools: event.allowedTools,
        timestamp: event.ts,
      });
      void resolveAndRecordSkillFile(sid, event.skill, null, contextFileHintsSeen);
    }

    if (event.kind === "ToolInput") {
      if (event.toolName.startsWith("mcp__")) {
        void resolveAndRecordContextFiles(sid, "mcp", event.toolName, "MCP", agentId, contextFileHintsSeen);
      }

      // Suppress phantom Read events during subagent context re-serialization.
      // When a subagent is in flight but sidechainActive is false and the last
      // main-agent tool was Agent, ToolInput(Read) events are re-serialized
      // conversation context, not genuine tool executions.
      const isPhantomRead = event.toolName === "Read"
        && subTracker.isSubagentInFlight()
        && !isSidechain
        && subTracker.getLastMainToolCall?.() === "Agent";
      if (isPhantomRead) {
        dlog("tap", sid, `phantom Read suppressed: ${event.input.file_path}`, "DEBUG");
      }

      const rawFilePath = event.input.file_path ?? event.input.notebook_path;
      if (typeof rawFilePath === "string" && !isPhantomRead) {
        const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
        const workDir = session?.config.workingDir ?? "";
        const filePath = resolveActivityPath(rawFilePath, workDir);
        const isExternal = isExternalActivityPath(filePath, workDir);

        if (event.toolName === "Read") {
          activityStore.addFileActivity(sid, filePath, "read", {
            agentId,
            toolName: "Read",
            isExternal,
          });
        } else if (event.toolName === "Write") {
          const activity = activityStore.sessions[sid];
          const isNew = !activity?.visitedPaths.has(filePath);
          const toolInputData: ToolInputDiffData = {
            type: "write",
            content: String(event.input.content ?? ""),
          };
          activityStore.addFileActivity(sid, filePath, isNew ? "created" : "modified", {
            agentId,
            toolName: "Write",
            isExternal,
            toolInputData,
          });
        } else if (event.toolName === "Edit") {
          const toolInputData: ToolInputDiffData = {
            type: "edit",
            oldString: String(event.input.old_string ?? ""),
            newString: String(event.input.new_string ?? ""),
          };
          activityStore.addFileActivity(sid, filePath, "modified", {
            agentId,
            toolName: "Edit",
            isExternal,
            toolInputData,
          });
        } else if (event.toolName === "NotebookEdit") {
          activityStore.addFileActivity(sid, filePath, "modified", {
            agentId,
            toolName: "NotebookEdit",
            isExternal,
          });
        }
      }

      if (event.toolName === "apply_patch") {
        const patch = typeof event.input.patch === "string" ? event.input.patch : "";
        if (patch) {
          const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
          const workDir = session?.config.workingDir ?? "";
          for (const file of parseApplyPatchFiles(patch, workDir)) {
            const isExternal = isExternalActivityPath(file.path, workDir);
            activityStore.addFileActivity(sid, file.path, file.kind, {
              agentId,
              toolName: "apply_patch",
              isExternal,
            });
          }
        }
      }

      // Grep — track searched file or folder
      if (event.toolName === "Grep") {
        const rawGrepPath = typeof event.input.path === "string" ? event.input.path : null;
        if (rawGrepPath) {
          const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
          const workDir = session?.config.workingDir ?? "";
          const grepPath = resolveActivityPath(rawGrepPath, workDir);
          const isExternal = isExternalActivityPath(grepPath, workDir);
          const lastSegment = grepPath.split("/").pop() ?? "";
          const looksLikeFile = lastSegment.includes(".") && !lastSegment.startsWith(".");
          activityStore.addFileActivity(sid, grepPath, "searched", {
            agentId,
            toolName: "Grep",
            isExternal,
            isFolder: !looksLikeFile,
          });
        } else {
          // No path = searching project root
          const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
          const workDir = session?.config.workingDir ?? "";
          if (workDir) {
            activityStore.addFileActivity(sid, canonicalizePath(workDir), "searched", {
              agentId,
              toolName: "Grep",
              isFolder: true,
            });
          }
        }
      }

      // Glob — always targets a folder
      if (event.toolName === "Glob") {
        const rawGlobPath = typeof event.input.path === "string" ? event.input.path : null;
        const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
        const workDir = session?.config.workingDir ?? "";
        const targetPath = rawGlobPath ? resolveActivityPath(rawGlobPath, workDir) : (workDir ? canonicalizePath(workDir) : null);
        if (targetPath) {
          const isExternal = isExternalActivityPath(targetPath, workDir);
          activityStore.addFileActivity(sid, targetPath, "searched", {
            agentId,
            toolName: "Glob",
            isExternal,
            isFolder: true,
          });
        }
      }

      // LSP — always targets a file (uses camelCase filePath, not snake_case file_path)
      if (event.toolName === "LSP") {
        const rawLspPath = typeof event.input.filePath === "string" ? event.input.filePath : null;
        if (rawLspPath) {
          const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
          const workDir = session?.config.workingDir ?? "";
          const lspPath = resolveActivityPath(rawLspPath, workDir);
          const isExternal = isExternalActivityPath(lspPath, workDir);
          activityStore.addFileActivity(sid, lspPath, "searched", {
            agentId,
            toolName: "LSP",
            isExternal,
          });
        }
      }

      // [DF-12] Bash — extract file ops by tokenizing the command string with shell-quote
      // and walking a small registry for mutations plus common read/search commands.
      // This is heuristic: subshells, var expansion, and globs are not handled. Path
      // existence is verified by the settled-idle validator before entries are finalized.
      if (event.toolName === "Bash") {
        const cmd = typeof event.input.command === "string" ? event.input.command : "";
        if (cmd) {
          const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
          const workDir = session?.config.workingDir ?? "";
          const commandWorkDir = typeof event.input.workdir === "string"
            ? event.input.workdir
            : typeof event.input.cwd === "string" ? event.input.cwd : workDir;
          const ops = parseBashFiles(cmd, commandWorkDir);
          for (const op of ops) {
            const isExternal = isExternalActivityPath(op.path, workDir);
            activityStore.addFileActivity(sid, op.path, op.kind, {
              agentId,
              toolName: "Bash",
              isExternal,
              isFolder: op.isFolder ?? false,
            });
          }
        }
      }
    }

    // [CP-02] Structured Codex parsed_cmd records add read/search activity from exec_command_end.
    if (event.kind === "CodexToolCallComplete" && event.parsedCmd) {
      const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
      const workDir = session?.config.workingDir ?? "";
      const commandWorkDir = event.cwd ?? workDir;
      for (const op of codexParsedCommandActivities(event.parsedCmd, commandWorkDir)) {
        const isExternal = isExternalActivityPath(op.path, workDir);
        activityStore.addFileActivity(sid, op.path, op.kind, {
          agentId,
          toolName: event.toolName ?? "Bash",
          isExternal,
          isFolder: op.isFolder,
        });
      }
    }

    if (event.kind === "PermissionRejected") {
      const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
      const lastAction = session?.metadata.currentAction ?? "";
      const pathMatch = lastAction.match(/:\s*(.+)/);
      if (pathMatch) {
        activityStore.markPermissionDenied(sid, canonicalizePath(pathMatch[1].trim()));
      }
    }

    if (event.kind === "InstructionsLoadedEvent") {
      recordContextPath(
        sid,
        event.filePath,
        event.memoryType,
        event.loadReason,
        event.memoryType === "skill" ? "Skill" : "context",
        agentId,
      );
    }

    if (event.kind === "ContextFilesHint") {
      void resolveAndRecordContextFiles(
        sid,
        event.contextKind,
        event.label,
        event.contextKind === "mcp" ? "MCP" : "context",
        agentId,
        contextFileHintsSeen,
      );
    }

    if (event.kind === "ContextBudget" && event.claudeMdSize > 0) {
      void resolveAndRecordContextFiles(
        sid,
        "rules",
        "Claude rules",
        "context",
        agentId,
        contextFileHintsSeen,
      );
    }
  };

  return {
    endTurn,
    handleEvent,
    markUserMessage,
  };
}
