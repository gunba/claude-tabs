import type { CliKind } from "../types/session";

export interface ChangelogEntry {
  version: string;
  date?: string | null;
  body: string;
  url?: string | null;
}

export interface CliChangelog {
  cli: CliKind;
  sourceUrl: string;
  fromVersion?: string | null;
  toVersion?: string | null;
  entries: ChangelogEntry[];
  truncated: boolean;
}

export type ChangelogRange = {
  fromVersion?: string | null;
  toVersion?: string | null;
};

export type ChangelogRequest = {
  kind: "startup" | "manual";
  initialCli: CliKind;
  ranges: Partial<Record<CliKind, ChangelogRange>>;
};

type VersionParts = {
  nums: number[];
  pre: string | null;
};

export function normalizeCliVersion(version: string | null | undefined): string | null {
  if (!version) return null;
  const match = version.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

function parseVersion(version: string | null | undefined): VersionParts | null {
  const normalized = normalizeCliVersion(version);
  if (!normalized) return null;
  const [core, suffix = ""] = normalized.split(/[-+]/, 2);
  return {
    nums: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    pre: suffix || null,
  };
}

function comparePrerelease(a: string, b: string): number {
  const aa = a.split(".");
  const bb = b.split(".");
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i += 1) {
    const av = aa[i];
    const bv = bb[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    const an = /^\d+$/.test(av) ? Number.parseInt(av, 10) : null;
    const bn = /^\d+$/.test(bv) ? Number.parseInt(bv, 10) : null;
    if (an !== null && bn !== null && an !== bn) return an > bn ? 1 : -1;
    if (an !== null && bn === null) return -1;
    if (an === null && bn !== null) return 1;
    if (av !== bv) return av.localeCompare(bv);
  }
  return 0;
}

export function compareCliVersions(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i += 1) {
    const av = pa.nums[i] ?? 0;
    const bv = pb.nums[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return comparePrerelease(pa.pre, pb.pre);
}

export function isCliVersionIncrease(current: string | null | undefined, previous: string | null | undefined): boolean {
  return compareCliVersions(current, previous) > 0;
}
