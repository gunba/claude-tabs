import { describe, expect, it, vi } from "vitest";
import { createUnsavedTextEditorRegistry } from "../UnsavedTextEditors";

describe("createUnsavedTextEditorRegistry", () => {
  it("returns registered dirty snapshots with save callbacks", async () => {
    const registry = createUnsavedTextEditorRegistry();
    const save = vi.fn(async () => {});

    registry.register(
      "settings:user",
      () => ({ title: "Settings (User)", before: "old", after: "new" }),
      () => save,
    );

    const changes = registry.getChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      id: "settings:user",
      title: "Settings (User)",
      before: "old",
      after: "new",
    });
    expect(changes[0].save).toBe(save);

    await changes[0].save?.();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("normalizes line endings before comparing snapshots", () => {
    const registry = createUnsavedTextEditorRegistry();

    registry.register(
      "crlf",
      () => ({ title: "CRLF", before: "one\r\ntwo\r\n", after: "one\ntwo\n" }),
    );

    expect(registry.getChanges()).toEqual([]);
  });

  it("uses current snapshot state after a save updates the baseline", async () => {
    const registry = createUnsavedTextEditorRegistry();
    let saved = "old";
    let current = "new";
    const save = vi.fn(async () => {
      saved = current;
    });

    registry.register(
      "settings:project",
      () => ({ title: "Settings (Project)", before: saved, after: current }),
      () => save,
    );

    const [pending] = registry.getChanges();
    expect(pending.before).toBe("old");
    expect(pending.after).toBe("new");

    await pending.save?.();

    expect(registry.getChanges()).toEqual([]);

    current = "newer";
    expect(registry.getChanges()).toMatchObject([
      { id: "settings:project", before: "new", after: "newer" },
    ]);
  });

  it("unregisters only the active entry for an id", () => {
    const registry = createUnsavedTextEditorRegistry();
    const unregisterOld = registry.register("same", () => ({ title: "Old", before: "a", after: "b" }));
    const unregisterNew = registry.register("same", () => ({ title: "New", before: "a", after: "c" }));

    unregisterOld();
    expect(registry.getChanges()).toMatchObject([{ id: "same", title: "New", after: "c" }]);

    unregisterNew();
    expect(registry.getChanges()).toEqual([]);
  });
});
