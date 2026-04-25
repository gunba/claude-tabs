import type { StatusMessage } from "../../lib/settingsSchema";
import { formatScopePath } from "../../lib/paths";
import type { CliKind } from "../../types/session";
import { IconUser, IconBraces, IconTerminal } from "../Icons/Icons";

export interface PaneComponentProps {
  scope: "user" | "project" | "project-local";
  projectDir: string;
  cli: CliKind;
  onStatus: (msg: StatusMessage | null) => void;
}

export type TabId = "settings" | "claudemd" | "hooks" | "plugins" | "mcp" | "agents" | "skills";

interface ThreePaneEditorProps {
  component: React.ComponentType<PaneComponentProps>;
  projectDir: string;
  cli?: CliKind;
  onStatus: (msg: StatusMessage | null) => void;
  tabId: TabId;
  scopes?: PaneComponentProps["scope"][];
}

export function scopePath(scope: PaneComponentProps["scope"], dir: string, tabId: TabId, cli: CliKind = "claude"): string {
  const d = dir || ".";
  if (cli === "codex") {
    switch (tabId) {
      case "settings":
      case "hooks":
      case "mcp":
        if (scope === "user") return "~/.codex/config.toml";
        return `${d}/.codex/config.toml`;
      case "claudemd":
        if (scope === "user") return "~/.codex/AGENTS.md";
        if (scope === "project") return `${d}/AGENTS.md`;
        return `${d}/AGENTS.local.md`;
      case "skills":
        if (scope === "user") return "~/.agents/skills/";
        return `${d}/.agents/skills/`;
      case "plugins":
        return "~/.codex/plugins/";
      case "agents":
        return `${d}/AGENTS.md`;
    }
  }
  switch (tabId) {
    case "settings":
    case "hooks":
    case "plugins":
    case "mcp":
      if (scope === "user") return "~/.claude/settings.json";
      if (scope === "project") return `${d}/.claude/settings.json`;
      return `${d}/.claude/settings.local.json`;
    case "claudemd":
      if (scope === "user") return "~/.claude/CLAUDE.md";
      if (scope === "project") return `${d}/CLAUDE.md`;
      return `${d}/CLAUDE.local.md`;
    case "agents":
      if (scope === "user") return "~/.claude/agents/";
      return `${d}/.claude/agents/`;
    case "skills":
      if (scope === "user") return "~/.claude/{commands,skills}/";
      return `${d}/.claude/{commands,skills}/`;
  }
}

export const SCOPES: { value: PaneComponentProps["scope"]; label: string; colorVar: string; icon: React.ReactNode }[] = [
  { value: "user", label: "USER", colorVar: "var(--accent)", icon: <IconUser size={12} /> },
  { value: "project", label: "PROJECT", colorVar: "var(--accent-secondary)", icon: <IconBraces size={12} /> },
  { value: "project-local", label: "LOCAL", colorVar: "var(--accent-tertiary)", icon: <IconTerminal size={12} /> },
];

// [CM-12] Optional scopes prop: 3 col (User/Project/Local) or 2 col (User/Project). Color coded: clay/blue/purple.
// [CM-22] Scope headers show actual file paths via formatScopePath()
export function ThreePaneEditor({ component: PaneComponent, projectDir, cli = "claude", onStatus, tabId, scopes }: ThreePaneEditorProps) {
  const visibleScopes = scopes ? SCOPES.filter((s) => scopes.includes(s.value)) : SCOPES;
  return (
    <div className="three-pane-grid" style={{ gridTemplateColumns: `repeat(${visibleScopes.length}, 1fr)` }}>
      {visibleScopes.map(({ value, label, colorVar, icon }) => (
        <div key={value} className="three-pane-column" style={{ "--scope-color": colorVar } as React.CSSProperties}>
          <div className="three-pane-header">
            <span className="three-pane-icon" style={{ color: colorVar }}>{icon}</span>
            <span className="three-pane-label">{label}</span>
            <span className="three-pane-path">{formatScopePath(scopePath(value, projectDir, tabId, cli))}</span>
          </div>
          <div className="three-pane-body">
            <PaneComponent scope={value} projectDir={projectDir} cli={cli} onStatus={onStatus} />
          </div>
        </div>
      ))}
    </div>
  );
}
