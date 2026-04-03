import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore, DEFAULT_NOISY_EVENT_KINDS } from "../../store/settings";
import { getNoisyEventKinds } from "../noisyEventKinds";

describe("getNoisyEventKinds", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      recordingConfig: {
        ...useSettingsStore.getState().recordingConfig,
        noisyEventKinds: DEFAULT_NOISY_EVENT_KINDS,
      },
    });
  });

  it("returns the default noisy event kinds", () => {
    const set = getNoisyEventKinds();
    expect(set.has("ApiTelemetry")).toBe(true);
    expect(set.has("ProcessHealth")).toBe(true);
    expect(set.has("EnvAccess")).toBe(true);
    expect(set.has("TextDecoderChunk")).toBe(true);
    expect(set.size).toBe(4);
  });

  it("does not include non-noisy kinds", () => {
    const set = getNoisyEventKinds();
    expect(set.has("TurnStart")).toBe(false);
    expect(set.has("ApiFetch")).toBe(false);
  });

  it("updates when config changes", () => {
    useSettingsStore.setState({
      recordingConfig: {
        ...useSettingsStore.getState().recordingConfig,
        noisyEventKinds: ["TurnStart"],
      },
    });
    const set = getNoisyEventKinds();
    expect(set.has("TurnStart")).toBe(true);
    expect(set.has("ApiTelemetry")).toBe(false);
    expect(set.size).toBe(1);
  });

  it("returns empty set when noisyEventKinds is empty", () => {
    useSettingsStore.setState({
      recordingConfig: {
        ...useSettingsStore.getState().recordingConfig,
        noisyEventKinds: [],
      },
    });
    expect(getNoisyEventKinds().size).toBe(0);
  });
});
