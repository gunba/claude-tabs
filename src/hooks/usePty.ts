import { useCallback, useRef } from "react";
import { spawn as ptySpawn, type IPty, type IDisposable } from "tauri-pty";

export interface PtyHandle {
  pid: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

interface UsePtyOptions {
  onData: (data: Uint8Array) => void;
  onExit?: (info: { exitCode: number; signal?: number }) => void;
}

export function usePty({ onData, onExit }: UsePtyOptions) {
  const ptyRef = useRef<IPty | null>(null);
  const disposablesRef = useRef<IDisposable[]>([]);
  const handleRef = useRef<PtyHandle | null>(null);

  const spawn = useCallback(
    (
      file: string,
      args: string[],
      cwd: string,
      cols: number,
      rows: number
    ): PtyHandle => {
      // Spawn PTY — omit env so tauri-pty inherits parent process environment
      const pty = ptySpawn(file, args, {
        cwd,
        cols,
        rows,
      });

      ptyRef.current = pty;

      // Subscribe to data and exit events.
      // IMPORTANT: tauri-pty types onData as Uint8Array, but tauri-plugin-pty's
      // Rust read() returns Vec<u8> which Tauri IPC serializes as a JSON number[].
      // We must convert to a real Uint8Array so TextDecoder and xterm.js work.
      const dataSub = pty.onData((data: Uint8Array) => {
        const bytes =
          data instanceof Uint8Array ? data : Uint8Array.from(data as unknown as number[]);
        onData(bytes);
      });
      disposablesRef.current.push(dataSub);

      const exitSub = pty.onExit((info) => {
        onExit?.(info);
      });
      disposablesRef.current.push(exitSub);

      const handle: PtyHandle = {
        pid: pty.pid,
        write: (data: string) => pty.write(data),
        resize: (cols: number, rows: number) => pty.resize(cols, rows),
        kill: () => {
          disposablesRef.current.forEach((d) => d.dispose());
          disposablesRef.current = [];
          pty.kill();
          ptyRef.current = null;
        },
      };

      handleRef.current = handle;
      return handle;
    },
    [onData, onExit]
  );

  const cleanup = useCallback(() => {
    handleRef.current?.kill();
    handleRef.current = null;
  }, []);

  return { spawn, cleanup, handle: handleRef };
}
