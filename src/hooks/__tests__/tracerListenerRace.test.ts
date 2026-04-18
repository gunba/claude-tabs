import { describe, it, expect, vi } from "vitest";

/**
 * Regression test for the useTapEventProcessor tracer-listener cleanup race.
 * [AS-05]: a React effect that calls `listen(...)` can unmount while the
 * promise is still pending. Without a `cancelled` flag the assignment
 * `unsubTracer = u` lands AFTER the cleanup ran, so the unlisten is never
 * invoked and the global event listener leaks for the lifetime of the app.
 *
 * We model the exact pattern from the hook in isolation so the guarantee
 * is tested without spinning up React or Tauri.
 */

type UnlistenFn = () => void;

function installSubscription(
  listen: () => Promise<UnlistenFn>,
): () => void {
  let unsub: UnlistenFn | null = null;
  let cancelled = false;
  listen().then((u) => {
    if (cancelled) u();
    else unsub = u;
  });
  return () => {
    cancelled = true;
    unsub?.();
  };
}

describe("tracer listener cleanup race", () => {
  it("releases the subscription when cleanup resolves before listen()", async () => {
    const unlisten = vi.fn();
    let resolveListen: (u: UnlistenFn) => void = () => {};
    const listen = () =>
      new Promise<UnlistenFn>((r) => {
        resolveListen = r;
      });

    const cleanup = installSubscription(listen);

    // Cleanup fires BEFORE listen() resolves (fast unmount).
    cleanup();
    resolveListen(unlisten);

    // Flush the microtask that handles the .then() callback.
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("releases the subscription on normal unmount after listen() resolved", async () => {
    const unlisten = vi.fn();
    const listen = () => Promise.resolve<UnlistenFn>(unlisten);

    const cleanup = installSubscription(listen);
    // Let listen()'s .then() land.
    await Promise.resolve();

    cleanup();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("does not double-unlisten when cleanup fires both before and after resolve", async () => {
    const unlisten = vi.fn();
    let resolveListen: (u: UnlistenFn) => void = () => {};
    const listen = () =>
      new Promise<UnlistenFn>((r) => {
        resolveListen = r;
      });

    const cleanup = installSubscription(listen);
    cleanup(); // flips cancelled
    resolveListen(unlisten); // .then() sees cancelled, calls unlisten once
    await Promise.resolve();
    cleanup(); // repeated cleanup — unsub is still null (never assigned), no-op

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
