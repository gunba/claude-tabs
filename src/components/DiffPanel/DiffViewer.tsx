import { useState, useMemo } from "react";
import type { FileDiff, DiffLine } from "../../types/git";

interface DiffViewerProps {
  diff: FileDiff;
}

const COLLAPSE_THRESHOLD = 80;

const ROW_CLASS: Record<DiffLine["kind"], string> = {
  add: "diff-line-add",
  del: "diff-line-del",
  context: "diff-line-context",
  "hunk-header": "diff-line-hunk",
};

const PREFIX: Record<DiffLine["kind"], string> = {
  add: "+",
  del: "-",
  context: " ",
  "hunk-header": "",
};

function DiffLineRow({ line }: { line: DiffLine }) {
  return (
    <tr className={ROW_CLASS[line.kind]}>
      <td className="diff-ln diff-ln-old">{line.oldLine ?? ""}</td>
      <td className="diff-ln diff-ln-new">{line.newLine ?? ""}</td>
      <td className="diff-content">
        {line.kind !== "hunk-header" && (
          <span className="diff-prefix">{PREFIX[line.kind]}</span>
        )}
        {line.content}
      </td>
    </tr>
  );
}

export function DiffViewer({ diff }: DiffViewerProps) {
  const allLines = useMemo(() => diff.hunks.flatMap((h) => h.lines), [diff.hunks]);

  const [expanded, setExpanded] = useState(allLines.length <= COLLAPSE_THRESHOLD);

  if (diff.isBinary) {
    return <div className="diff-binary">Binary file differs</div>;
  }

  if (diff.hunks.length === 0) {
    return <div className="diff-binary">No changes</div>;
  }

  const banner = diff.isNew ? (
    <div className="diff-file-banner diff-file-banner-new">new file</div>
  ) : diff.isDeleted ? (
    <div className="diff-file-banner diff-file-banner-deleted">deleted file</div>
  ) : null;

  const visibleLines = expanded ? allLines : allLines.slice(0, COLLAPSE_THRESHOLD);
  const hiddenCount = allLines.length - visibleLines.length;

  return (
    <div className="diff-viewer">
      {banner}
      <table className="diff-viewer-table">
        <tbody>
          {visibleLines.map((line, i) => (
            <DiffLineRow key={i} line={line} />
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 && (
        <button className="diff-show-more" onClick={() => setExpanded(true)}>
          Show {hiddenCount} more lines
        </button>
      )}
      {diff.truncated && (
        <div className="diff-truncated">Diff truncated (&gt;500KB)</div>
      )}
    </div>
  );
}
