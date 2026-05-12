import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { parentDir } from "../../lib/paths";

export interface ActivityContextMenuRequest {
  x: number;
  y: number;
  path: string;
  isFolder: boolean;
}

interface ActivityContextMenuProps {
  menu: ActivityContextMenuRequest;
  onClose: () => void;
}

export function ActivityContextMenu({ menu, onClose }: ActivityContextMenuProps) {
  const folder = menu.isFolder ? menu.path : parentDir(menu.path);

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 199 }}
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="tab-context-menu"
        style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="tab-context-menu-item"
          onClick={() => {
            navigator.clipboard.writeText(menu.path);
            onClose();
          }}
        >
          Copy Path
        </button>
        {!menu.isFolder && (
          <button
            className="tab-context-menu-item"
            onClick={() => {
              navigator.clipboard.writeText(folder);
              onClose();
            }}
          >
            Copy Folder Path
          </button>
        )}
        <div className="tab-context-menu-divider" />
        <button
          className="tab-context-menu-item"
          onClick={() => {
            if (menu.isFolder) {
              // Folder: open it directly so the user sees its contents.
              invoke("shell_open", { path: menu.path });
            } else {
              // File: reveal in parent folder with the file highlighted.
              // Cross-platform via reveal_in_file_manager (data.rs:288):
              // Windows uses explorer.exe /select, macOS uses open -R,
              // Linux falls back to xdg-open on the parent dir (no highlight).
              invoke("reveal_in_file_manager", { path: menu.path });
            }
            onClose();
          }}
        >
          {menu.isFolder ? "Open Folder" : "Open Containing Folder"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
