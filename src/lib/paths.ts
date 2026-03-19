/**
 * Unified path utilities for Claude Tabs.
 *
 * All path manipulation (normalization, display formatting, filter matching)
 * lives here. Mirrors the Rust-side path_utils.rs module.
 */

/** Normalize a Windows path: forward slashes to backslashes, strip trailing. */
export function normalizePath(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+$/, "");
}

/** Derive a short tab name from the last component of a directory path. */
export function dirToTabName(dir: string): string {
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || dir;
}

/** Abbreviate a full directory path for display: keep last two components. */
export function abbreviatePath(dir: string): string {
  const normalized = dir.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `~/${parts.slice(-2).join("/")}`;
}

/**
 * Normalize a path or string for fuzzy filter matching.
 * Collapses all non-alphanumeric chars to hyphens and lowercases.
 *
 * This mirrors encode_dir's lossy encoding: "Jordan.Graham", "Jordan/Graham",
 * and "Jordan-Graham" all normalize to "jordan-graham", so filtering works
 * regardless of whether the path was decoded correctly.
 */
export function normalizeForFilter(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
}
