import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

// [UT-01] UnsavedTextEditorRegistry: editors register pre/post-save snapshots; ConfigManager collects pending changes on close/switch and prompts via DiscardChangesDialog with per-editor unified diff preview.
export interface UnsavedTextEditorChange {
  id: string;
  title: string;
  before: string;
  after: string;
}

type UnsavedTextEditorSnapshot = Omit<UnsavedTextEditorChange, "id"> | null;

function normaliseLineEndings(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

export interface UnsavedTextEditorRegistry {
  register: (id: string, getChange: () => UnsavedTextEditorSnapshot) => () => void;
  getChanges: () => UnsavedTextEditorChange[];
}

const UnsavedTextEditorContext = createContext<UnsavedTextEditorRegistry | null>(null);

export function useUnsavedTextEditorRegistry(): UnsavedTextEditorRegistry {
  const entriesRef = useRef(new Map<string, () => UnsavedTextEditorSnapshot>());

  const register = useCallback((id: string, getChange: () => UnsavedTextEditorSnapshot) => {
    entriesRef.current.set(id, getChange);
    return () => {
      if (entriesRef.current.get(id) === getChange) {
        entriesRef.current.delete(id);
      }
    };
  }, []);

  const getChanges = useCallback(() => {
    const changes: UnsavedTextEditorChange[] = [];
    for (const [id, getChange] of entriesRef.current) {
      const raw = getChange();
      if (!raw) continue;
      // Browsers normalise textarea \r\n -> \n in .value, but a file read
      // from disk keeps whatever line endings it had. Compare and render
      // the diff in the normalised form so CRLF files don't trip the
      // guard with no edits — and so the diff preview doesn't paint
      // every line as a change for the same reason.
      const before = normaliseLineEndings(raw.before);
      const after = normaliseLineEndings(raw.after);
      if (before === after) continue;
      changes.push({ id, title: raw.title, before, after });
    }
    return changes;
  }, []);

  return useMemo(() => ({ register, getChanges }), [register, getChanges]);
}

export function UnsavedTextEditorProvider({
  registry,
  children,
}: {
  registry: UnsavedTextEditorRegistry;
  children: ReactNode;
}) {
  return (
    <UnsavedTextEditorContext.Provider value={registry}>
      {children}
    </UnsavedTextEditorContext.Provider>
  );
}

export function useUnsavedTextEditor(id: string, getChange: () => UnsavedTextEditorSnapshot) {
  const registry = useContext(UnsavedTextEditorContext);
  const getChangeRef = useRef(getChange);

  useEffect(() => {
    getChangeRef.current = getChange;
  }, [getChange]);

  useEffect(() => {
    if (!registry) return;
    return registry.register(id, () => getChangeRef.current());
  }, [registry, id]);
}
