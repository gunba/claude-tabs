import mascotSrc from "../../assets/agent-mascot.png";

export type MascotState = "reading" | "writing" | "moving" | "idle" | "searching";

interface AgentMascotProps {
  state: MascotState;
  isSubagent?: boolean;
  isCompleted?: boolean;
  size?: number;
}

const OVERLAY: Record<MascotState, string | null> = {
  reading: "\uD83D\uDC41",  // eye
  writing: "\u270F",         // pencil
  searching: "\uD83D\uDD0D", // magnifying glass
  moving: null,
  idle: null,
};

export function AgentMascot({ state, isSubagent, isCompleted, size = 20 }: AgentMascotProps) {
  const overlay = OVERLAY[state];
  // [AP-04] Completed subagents reuse the same mascot with a dimmed, no-animation class.
  const classes = `agent-mascot agent-mascot-${state}${isSubagent ? " agent-mascot-subagent" : ""}${isCompleted ? " agent-mascot-completed" : ""}`;

  return (
    <span
      className={classes}
      style={{ width: size, height: size }}
    >
      <img
        className="agent-mascot-img"
        src={mascotSrc}
        alt=""
        width={size}
        height={size}
        draggable={false}
      />
      {overlay && <span className="agent-mascot-overlay">{overlay}</span>}
    </span>
  );
}
