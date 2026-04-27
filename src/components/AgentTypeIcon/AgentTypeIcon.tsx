import {
  IconBot,
  IconBookOpen,
  IconClipboard,
  IconCompass,
  IconShieldCheck,
  IconSparkles,
  IconTerminal,
} from "../Icons/Icons";

// [CV-05] Subagent-type to icon mapping — built-ins from claude_code/src/tools/AgentTool/builtInAgents.ts.
// Anything else falls back to the generic Bot icon.
const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  "general-purpose": IconSparkles,
  Explore: IconCompass,
  Plan: IconClipboard,
  "claude-code-guide": IconBookOpen,
  "statusline-setup": IconTerminal,
  verification: IconShieldCheck,
};

interface AgentTypeIconProps {
  type?: string | null;
  size?: number;
  className?: string;
}

export function AgentTypeIcon({ type, size = 12, className }: AgentTypeIconProps) {
  const Icon = (type && ICONS[type]) || IconBot;
  return <Icon size={size} className={className} />;
}
