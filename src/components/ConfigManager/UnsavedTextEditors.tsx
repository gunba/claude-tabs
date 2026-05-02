import { createContext, useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";

// [UT-01] UnsavedTextEditorRegistry: editors register pre/post-save snapshots plus optional save callbacks; ConfigManager collects pending changes on close/switch and prompts via DiscardChangesDialog with per-editor unified diff preview.
export interface UnsavedTextEditorChange {
  id: string;
  title: string;
  before: string;
  after: string;
  save?: () => Promise<unknown>;
}

type UnsavedTextEditorSnapshot = Omit<UnsavedTextEditorChange, "id" | "save"> | null;
type UnsavedTextEditorSave = () => Promise<unknown>;
type UnsavedTextEditorEntry = {
  getChange: () => UnsavedTextEditorSnapshot;
  getSave?: () => UnsavedTextEditorSave | null;
};

function normaliseLineEndings(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

export interface UnsavedTextEditorRegistry {
  register: (
    id: string,
    getChange: () => UnsavedTextEditorSnapshot,
    getSave?: () => UnsavedTextEditorSave | null,
  ) => () => void;
  getChanges: () => UnsavedTextEditorChange[];
}

const UnsavedTextEditorContext = createContext<UnsavedTextEditorRegistry | null>(null);

export function createUnsavedTextEditorRegistry(): UnsavedTextEditorRegistry {
  const entries = new Map<string, UnsavedTextEditorEntry>();

  const register = (
    id: string,
    getChange: () => UnsavedTextEditorSnapshot,
    getSave?: () => UnsavedTextEditorSave | null,
  ) => {
    const entry = { getChange, getSave };
    entries.set(id, entry);
    return () => {
      if (entries.get(id) === entry) {
        entries.delete(id);
      }
    };
  };

  const getChanges = () => {
    const changes: UnsavedTextEditorChange[] = [];
    for (const [id, entry] of entries) {
      const raw = entry.getChange();
      if (!raw) continue;
      // Browsers normalise textarea \r\n -> \n in .value, but a file read
      // from disk keeps whatever line endings it had. Compare and render
      // the diff in the normalised form so CRLF files don't trip the
      // guard with no edits — and so the diff preview doesn't paint
      // every line as a change for the same reason.
      const before = normaliseLineEndings(raw.before);
      const after = normaliseLineEndings(raw.after);
      if (before === after) continue;
      const save = entry.getSave?.() ?? undefined;
      changes.push({ id, title: raw.title, before, after, save });
    }
    return changes;
  };

  return { register, getChanges };
}

export function useUnsavedTextEditorRegistry(): UnsavedTextEditorRegistry {
  const registryRef = useRef<UnsavedTextEditorRegistry | null>(null);
  if (!registryRef.current) registryRef.current = createUnsavedTextEditorRegistry();
  return registryRef.current;
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

export function useUnsavedTextEditor(
  id: string,
  getChange: () => UnsavedTextEditorSnapshot,
  options?: { save?: UnsavedTextEditorSave },
) {
  const registry = useContext(UnsavedTextEditorContext);
  const getChangeRef = useRef(getChange);
  const saveRef = useRef(options?.save);

  useEffect(() => {
    getChangeRef.current = getChange;
  }, [getChange]);

  useEffect(() => {
    saveRef.current = options?.save;
  }, [options?.save]);

  useEffect(() => {
    if (!registry) return;
    return registry.register(
      id,
      () => getChangeRef.current(),
      () => saveRef.current ?? null,
    );
  }, [registry, id]);
}
