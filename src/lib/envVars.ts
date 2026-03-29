export interface EnvVarEntry {
  name: string;
  description: string;
  category: string;
  documented: boolean;
}

export const CATEGORY_ORDER = ["api", "model", "features", "aws", "gcp", "network", "debug", "other"];

export const CATEGORY_LABELS: Record<string, string> = {
  api: "API & Auth",
  model: "Model",
  features: "Features",
  aws: "AWS / Bedrock",
  gcp: "GCP / Vertex",
  network: "Network / Proxy",
  debug: "Debug",
  other: "Other",
};

/** Group env vars by category in CATEGORY_ORDER, omitting empty categories */
export function groupEnvVars(vars: EnvVarEntry[]): Map<string, EnvVarEntry[]> {
  const groups = new Map<string, EnvVarEntry[]>();
  for (const cat of CATEGORY_ORDER) groups.set(cat, []);
  for (const v of vars) {
    const key = groups.has(v.category) ? v.category : "other";
    groups.get(key)!.push(v);
  }
  // Remove empty categories
  for (const [k, v] of groups) {
    if (v.length === 0) groups.delete(k);
  }
  return groups;
}
