import { describe, it, expect } from "vitest";
import { normalizeForFilter } from "../paths";
import type { PastSession } from "../../types/session";

// ── Helpers ──────────────────────────────────────────────────────────

function mkPastSession(overrides: Partial<PastSession> = {}): PastSession {
  return {
    id: "session-abc123",
    path: "C:/Users/jorda/.claude/projects/proj/session-abc123.jsonl",
    directory: "C:/Users/jorda/Projects/my-app",
    lastModified: "2026-03-22T10:00:00Z",
    sizeBytes: 4096,
    firstMessage: "Fix the login bug",
    lastMessage: "Done, all tests pass",
    parentId: null,
    model: "claude-sonnet-4-5-20250514",
    ...overrides,
  };
}

// ── Filter matching logic (mirrors ResumePicker lines 143-158) ──────
// This replicates the component's filter function as a pure function
// so we can test it without rendering React.

function matchesFilter(
  ps: PastSession,
  dirFilter: string,
  sessionNames: Record<string, string>
): boolean {
  if (!dirFilter.trim()) return true;
  const filterNorm = normalizeForFilter(dirFilter);
  const dirNorm = normalizeForFilter(ps.directory);
  if (dirNorm.includes(filterNorm) || filterNorm.includes(dirNorm)) return true;
  const name = sessionNames[ps.id];
  if (name && normalizeForFilter(name).includes(filterNorm)) return true;
  return false;
}

// ── Name resolution logic (mirrors ResumePicker resumeById, line 274) ──

function resolveResumeName(
  ps: PastSession,
  displayName: string | null | undefined,
  sessionNames: Record<string, string>
): string {
  return displayName || sessionNames[ps.id] || ps.path;
}

// ── Chain displayName resolution (mirrors ResumePicker lines 203-209) ──

interface ChainMember {
  id: string;
}

function resolveChainDisplayName(
  members: ChainMember[],
  sessionNames: Record<string, string>
): string | null {
  for (const m of members) {
    if (sessionNames[m.id]) {
      return sessionNames[m.id];
    }
  }
  return null;
}

// ── Tests: Filter matching by session name ──────────────────────────

describe("ResumePicker filter: name-search", () => {
  const session = mkPastSession({ id: "sess-1", directory: "C:/Users/jorda/Projects/my-app" });

  it("matches when filter is in session name", () => {
    const names = { "sess-1": "Login Bug Fix" };
    expect(matchesFilter(session, "login", names)).toBe(true);
  });

  it("matches session name case-insensitively", () => {
    const names = { "sess-1": "Login Bug Fix" };
    expect(matchesFilter(session, "LOGIN BUG", names)).toBe(true);
  });

  it("matches partial session name", () => {
    const names = { "sess-1": "refactor-authentication-module" };
    expect(matchesFilter(session, "auth", names)).toBe(true);
  });

  it("does not match when filter is not in name or directory", () => {
    const names = { "sess-1": "Login Bug Fix" };
    expect(matchesFilter(session, "database-migration", names)).toBe(false);
  });

  it("matches directory even when session has no name", () => {
    expect(matchesFilter(session, "my-app", {})).toBe(true);
  });

  it("matches directory when session name does not match", () => {
    const names = { "sess-1": "unrelated" };
    expect(matchesFilter(session, "my-app", names)).toBe(true);
  });

  it("matches name even when directory does not match", () => {
    const session2 = mkPastSession({ id: "s2", directory: "C:/totally/different/path" });
    const names = { s2: "important-task" };
    expect(matchesFilter(session2, "important", names)).toBe(true);
  });

  it("skips name check when sessionNames has no entry for this session", () => {
    const names = { "other-session": "Some Name" };
    expect(matchesFilter(session, "some-name", names)).toBe(false);
  });

  it("returns true for empty filter", () => {
    expect(matchesFilter(session, "", {})).toBe(true);
    expect(matchesFilter(session, "  ", {})).toBe(true);
  });

  it("normalizes special characters in session names", () => {
    const names = { "sess-1": "Fix Bug #42 (urgent)" };
    // normalizeForFilter turns "#42 (urgent)" into "-42--urgent-"
    expect(matchesFilter(session, "42", names)).toBe(true);
    expect(matchesFilter(session, "urgent", names)).toBe(true);
  });

  it("handles session name with periods (e.g., file extensions)", () => {
    const names = { "sess-1": "update config.json schema" };
    expect(matchesFilter(session, "config", names)).toBe(true);
    expect(matchesFilter(session, "json", names)).toBe(true);
  });
});

// ── Tests: Name resolution priority ─────────────────────────────────

describe("ResumePicker resumeById: name resolution", () => {
  const ps = mkPastSession({ id: "sess-1" });

  it("uses displayName when provided", () => {
    const names = { "sess-1": "stored name" };
    expect(resolveResumeName(ps, "explicit name", names)).toBe("explicit name");
  });

  it("falls back to sessionNames when displayName is null", () => {
    const names = { "sess-1": "stored name" };
    expect(resolveResumeName(ps, null, names)).toBe("stored name");
  });

  it("falls back to sessionNames when displayName is undefined", () => {
    const names = { "sess-1": "stored name" };
    expect(resolveResumeName(ps, undefined, names)).toBe("stored name");
  });

  it("falls back to ps.path when both displayName and sessionNames are absent", () => {
    expect(resolveResumeName(ps, null, {})).toBe(ps.path);
  });

  it("falls back to ps.path when displayName is empty string", () => {
    // Empty string is falsy, so falls through
    expect(resolveResumeName(ps, "", {})).toBe(ps.path);
  });

  it("prefers displayName over sessionNames even when both exist", () => {
    const names = { "sess-1": "stored" };
    expect(resolveResumeName(ps, "explicit", names)).toBe("explicit");
  });

  it("prefers sessionNames over ps.path when displayName is absent", () => {
    const names = { "sess-1": "named session" };
    expect(resolveResumeName(ps, null, names)).toBe("named session");
  });
});

// ── Tests: Chain displayName resolution ─────────────────────────────

describe("ResumePicker chain: displayName resolution", () => {
  it("returns name from first member that has an entry", () => {
    const members = [{ id: "latest" }, { id: "middle" }, { id: "oldest" }];
    const names = { middle: "My Task", oldest: "Old Name" };
    expect(resolveChainDisplayName(members, names)).toBe("My Task");
  });

  it("returns null when no member has a name", () => {
    const members = [{ id: "a" }, { id: "b" }];
    expect(resolveChainDisplayName(members, {})).toBeNull();
  });

  it("returns first member's name when all have names", () => {
    const members = [{ id: "a" }, { id: "b" }];
    const names = { a: "Name A", b: "Name B" };
    expect(resolveChainDisplayName(members, names)).toBe("Name A");
  });

  it("handles single-member chain with name", () => {
    const members = [{ id: "solo" }];
    const names = { solo: "Solo Session" };
    expect(resolveChainDisplayName(members, names)).toBe("Solo Session");
  });

  it("handles single-member chain without name", () => {
    const members = [{ id: "solo" }];
    expect(resolveChainDisplayName(members, {})).toBeNull();
  });

  it("skips members with empty-string names (empty string is falsy)", () => {
    // In sessionNames, an empty string entry would not be set — but
    // if it were, the component's `if (sessionNames[m.id])` guard
    // would skip it since "" is falsy.
    const members = [{ id: "a" }, { id: "b" }];
    const names: Record<string, string> = { a: "", b: "Real Name" };
    expect(resolveChainDisplayName(members, names)).toBe("Real Name");
  });
});

// ── Tests: normalizeForFilter with session-name patterns ────────────

describe("normalizeForFilter: session name patterns", () => {
  it("normalizes a human-readable session name", () => {
    expect(normalizeForFilter("Fix Login Bug")).toBe("fix-login-bug");
  });

  it("normalizes name with special chars", () => {
    expect(normalizeForFilter("bug #123: fix auth")).toBe("bug--123--fix-auth");
  });

  it("normalizes CamelCase name", () => {
    expect(normalizeForFilter("RefactorAuth")).toBe("refactorauth");
  });

  it("normalizes name with underscores", () => {
    expect(normalizeForFilter("add_new_feature")).toBe("add-new-feature");
  });

  it("normalizes empty string", () => {
    expect(normalizeForFilter("")).toBe("");
  });

  it("name substring matching works after normalization", () => {
    const name = normalizeForFilter("Update API endpoints v2");
    const filter = normalizeForFilter("api endpoints");
    expect(name.includes(filter)).toBe(true);
  });

  it("name with path separators normalizes same as directory", () => {
    // A name like "C:/foo/bar" normalizes to same pattern as a directory
    const nameNorm = normalizeForFilter("project/subdir");
    const dirNorm = normalizeForFilter("project\\subdir");
    expect(nameNorm).toBe(dirNorm);
  });
});
