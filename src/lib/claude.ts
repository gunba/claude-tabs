import { invoke } from "@tauri-apps/api/core";
import type { SessionConfig } from "../types/session";

export async function buildClaudeArgs(
  config: SessionConfig
): Promise<string[]> {
  return invoke<string[]>("build_claude_args", { config });
}

/** Derive a short tab name from the working directory */
export function dirToTabName(dir: string): string {
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || dir;
}

/** Model display label */
export function modelLabel(model: string | null): string {
  if (!model) return "Default";
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model;
}

/** Format token count compactly: <1K, 2.3K, 36K, 1.2M */
export function formatTokenCount(n: number): string {
  if (n < 1000) return n < 1 ? '<1' : `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
