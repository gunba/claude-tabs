import { useEffect, type DependencyList } from "react";

type AbortableEffect = (signal: AbortSignal) => void | (() => void);

export function useAbortableEffect(effect: AbortableEffect, deps: DependencyList): void {
  useEffect(() => {
    const controller = new AbortController();
    const cleanup = effect(controller.signal);
    return () => {
      controller.abort();
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
