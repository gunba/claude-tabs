import claudeMascot from "../../assets/claude-mascot.png";
import codexMascot from "../../assets/codex-mascot.png";
import "./ProviderLogo.css";

// [CV-04] Provider mascot renderer — single source of truth for Claude/Codex visual identity.

const SRC: Record<"claude" | "codex", string> = {
  claude: claudeMascot,
  codex: codexMascot,
};

const LABEL: Record<"claude" | "codex", string> = {
  claude: "Claude",
  codex: "Codex",
};

interface ProviderLogoProps {
  cli: "claude" | "codex";
  size?: number;
  className?: string;
  title?: string;
}

export function ProviderLogo({ cli, size = 14, className, title }: ProviderLogoProps) {
  const cls = `provider-logo provider-logo-${cli}${className ? ` ${className}` : ""}`;
  return (
    <img
      className={cls}
      src={SRC[cli]}
      alt={LABEL[cli]}
      width={size}
      height={size}
      title={title ?? LABEL[cli]}
      draggable={false}
    />
  );
}
