import { IconClose } from "../Icons/Icons";
import { ModalOverlay } from "../ModalOverlay/ModalOverlay";

export interface PruneRequest {
  sessionId: string;
  worktreePath: string;
  worktreeName: string;
  projectRoot: string;
}

interface PruneDialogProps {
  request: PruneRequest;
  onClose: () => void;
  onKeepWorktree: (request: PruneRequest) => void;
  onPruneWorktree: (request: PruneRequest) => void;
}

export function PruneDialog({
  request,
  onClose,
  onKeepWorktree,
  onPruneWorktree,
}: PruneDialogProps) {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="prune-dialog">
        <div className="prune-title">
          Close worktree session
          <button className="prune-close" onClick={onClose} title="Close (Esc)">
            <IconClose size={12} />
          </button>
        </div>
        <div className="prune-body">
          Prune worktree <strong>{request.worktreeName}</strong>?
        </div>
        <div className="prune-actions">
          <button onClick={() => onKeepWorktree(request)}>Keep worktree</button>
          <button
            className="prune-actions-danger"
            onClick={() => onPruneWorktree(request)}
          >
            Prune worktree
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
