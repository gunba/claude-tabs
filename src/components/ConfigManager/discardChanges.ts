import type { UnsavedTextEditorChange } from "./UnsavedTextEditors";

export const DISCARD_SAVE_UNAVAILABLE_MESSAGE = "Some listed changes cannot be saved from this dialog.";

export function canSaveDiscardChanges(changes: UnsavedTextEditorChange[]): boolean {
  return changes.length > 0 && changes.every((change) => typeof change.save === "function");
}

export function shouldIgnoreDiscardCloseRequest(hasPendingChanges: boolean, saving: boolean): boolean {
  return hasPendingChanges && saving;
}

export function formatDiscardSaveError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.startsWith("Invalid ") || message.startsWith("Save failed:")
    ? message
    : `Save failed: ${message}`;
}

export async function saveDiscardChanges(
  changes: UnsavedTextEditorChange[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!canSaveDiscardChanges(changes)) {
    return { ok: false, message: DISCARD_SAVE_UNAVAILABLE_MESSAGE };
  }

  try {
    for (const change of changes) {
      await change.save!();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: formatDiscardSaveError(err) };
  }
}
