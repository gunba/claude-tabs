import type { Session, Subagent } from "../types/session";
import { isSubagentActive } from "../types/session";
import {
  effectiveModel,
  effortColor,
  formatTokenCount,
  modelColor,
  modelLabel,
} from "./claude";
import { parseWorktreePath, worktreeAcronym } from "./paths";

export interface TabStatusSpan {
  text: string;
  color: string;
  title?: string;
}

export function buildTabStatusSpans(
  session: Session,
  subagents: readonly Subagent[],
): TabStatusSpan[] {
  const statusSpans: TabStatusSpan[] = [];
  const model = effectiveModel(session);
  if (model) {
    const label = modelLabel(model);
    const resolved = label !== model;
    const versionMatch = model.match(/(\d+)[.-](\d+)/);
    const version = resolved && versionMatch ? ` ${versionMatch[1]}.${versionMatch[2]}` : "";
    statusSpans.push({ text: label + version, color: modelColor(model) });
  }

  const effort = session.config.effort ?? session.metadata.effortLevel;
  if (effort) {
    statusSpans.push({
      text: effort.charAt(0).toUpperCase() + effort.slice(1),
      color: effortColor(effort),
    });
  }

  const liveAgents = subagents.filter((s) => isSubagentActive(s.state)).length;
  if (liveAgents > 0) {
    statusSpans.push({
      text: `${liveAgents} agent${liveAgents > 1 ? "s" : ""}`,
      color: "var(--text-secondary)",
    });
  }

  const worktree = parseWorktreePath(session.config.workingDir);
  if (worktree) {
    statusSpans.push({
      text: worktreeAcronym(worktree.worktreeName),
      color: "var(--accent-tertiary)",
      title: worktree.worktreeName,
    });
  }

  const statusLine = session.metadata.statusLine;
  if (statusLine) {
    const totalContext =
      statusLine.cacheCreationInputTokens +
      statusLine.cacheReadInputTokens +
      statusLine.currentInputTokens;
    if (totalContext > 0) {
      statusSpans.push({
        text: formatTokenCount(totalContext),
        color: "var(--text-muted)",
        title: `Context: ${statusLine.currentInputTokens.toLocaleString()} input + ${statusLine.cacheReadInputTokens.toLocaleString()} cache read + ${statusLine.cacheCreationInputTokens.toLocaleString()} cache write`,
      });
    }
  } else if (session.metadata.contextDebug) {
    const contextDebug = session.metadata.contextDebug;
    if (contextDebug.totalContextTokens > 0) {
      statusSpans.push({
        text: formatTokenCount(contextDebug.totalContextTokens),
        color: "var(--text-muted)",
        title: `Context: ${contextDebug.inputTokens.toLocaleString()} input + ${contextDebug.cacheRead.toLocaleString()} cache read + ${contextDebug.cacheCreation.toLocaleString()} cache write`,
      });
    }
  }

  return statusSpans;
}
