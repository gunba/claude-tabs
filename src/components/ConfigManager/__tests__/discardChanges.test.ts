import { describe, expect, it, vi } from "vitest";
import {
  DISCARD_SAVE_UNAVAILABLE_MESSAGE,
  canSaveDiscardChanges,
  formatDiscardSaveError,
  saveDiscardChanges,
  shouldIgnoreDiscardCloseRequest,
} from "../discardChanges";
import type { UnsavedTextEditorChange } from "../UnsavedTextEditors";

function change(id: string, save?: () => Promise<unknown>): UnsavedTextEditorChange {
  return { id, title: id, before: "old", after: "new", save };
}

describe("discard changes save helpers", () => {
  it("only enables save when every listed change has a save callback", () => {
    const save = vi.fn(async () => {});

    expect(canSaveDiscardChanges([])).toBe(false);
    expect(canSaveDiscardChanges([change("a", save)])).toBe(true);
    expect(canSaveDiscardChanges([change("a", save), change("b")])).toBe(false);
  });

  it("runs all save callbacks in order", async () => {
    const calls: string[] = [];
    const first = vi.fn(async () => { calls.push("first"); });
    const second = vi.fn(async () => { calls.push("second"); });

    await expect(saveDiscardChanges([change("a", first), change("b", second)])).resolves.toEqual({ ok: true });

    expect(calls).toEqual(["first", "second"]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("returns the dialog error when a change has no save callback", async () => {
    await expect(saveDiscardChanges([change("a")])).resolves.toEqual({
      ok: false,
      message: DISCARD_SAVE_UNAVAILABLE_MESSAGE,
    });
  });

  it("formats save failures for display without double-prefixing validation errors", async () => {
    await expect(saveDiscardChanges([change("a", async () => { throw new Error("disk full"); })])).resolves.toEqual({
      ok: false,
      message: "Save failed: disk full",
    });

    expect(formatDiscardSaveError(new Error("Invalid TOML: bad table"))).toBe("Invalid TOML: bad table");
    expect(formatDiscardSaveError(new Error("Save failed: denied"))).toBe("Save failed: denied");
  });

  it("keeps close shortcuts from canceling the dialog while a save is in flight", () => {
    expect(shouldIgnoreDiscardCloseRequest(true, true)).toBe(true);
    expect(shouldIgnoreDiscardCloseRequest(true, false)).toBe(false);
    expect(shouldIgnoreDiscardCloseRequest(false, true)).toBe(false);
  });
});
