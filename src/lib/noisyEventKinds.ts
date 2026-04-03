import { useSettingsStore } from "../store/settings";

/** Cached set of noisy event kinds, rebuilt when config changes. */
let cached: ReadonlySet<string> = new Set(
  useSettingsStore.getState().recordingConfig.noisyEventKinds,
);

useSettingsStore.subscribe((state, prev) => {
  if (state.recordingConfig.noisyEventKinds !== prev.recordingConfig.noisyEventKinds) {
    cached = new Set(state.recordingConfig.noisyEventKinds);
  }
});

/** Returns the current set of noisy event kinds (synchronous, cached). */
export function getNoisyEventKinds(): ReadonlySet<string> {
  return cached;
}
