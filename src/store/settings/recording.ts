import type { CliKind } from "../../types/session";

export interface RecordingConfig {
  taps: {
    enabled: boolean;
    categories: Record<string, boolean>;
  };
  traffic: { enabled: boolean };
  debugCapture: boolean;
  maxAgeHours: number;
  noisyEventKinds: string[];
}

export type RecordingConfigsByCli = Record<CliKind, RecordingConfig>;

export const DEFAULT_NOISY_EVENT_KINDS: string[] = [
  "ApiTelemetry", "ProcessHealth", "EnvAccess", "TextDecoderChunk",
];
export const DEFAULT_CODEX_NOISY_EVENT_KINDS: string[] = [
  ...DEFAULT_NOISY_EVENT_KINDS,
  "CodexTokenCount",
];

// [CI-05] Recording defaults: TAP/traffic disabled, all high-volume tap categories off, parse/stringify and codex-* categories on. v6 backfilled added categories with stdout/stderr forced off; v21 force-quiets persisted configs into recordingConfigsByCli.
// [CI-06] RecordingConfig.debugCapture field controls DEBUG-level capture (default false). v8 backfilled debugCapture=true for older states; v21 force-quiets it back to false alongside the other recording defaults.
export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  taps: {
    enabled: false,
    categories: {
      parse: true, stringify: true,
      console: false, fs: false, spawn: false, fetch: false,
      exit: false, timer: false, stdout: false, stderr: false,
      require: false, bun: false,
      websocket: false, net: false, stream: false,
      fspromises: false, bunfile: false, abort: false,
      fswatch: false, textdecoder: false, events: false, envproxy: false,
      "codex-session": true,
      "codex-turn-context": true,
      "codex-token-count": true,
      "codex-tool-call-start": true,
      "codex-tool-input": true,
      "codex-tool-call-complete": true,
      "codex-message": true,
      "codex-subagent-spawned": true,
      "codex-subagent-status": true,
      "codex-thread-name-updated": true,
      "codex-compacted": true,
      "system-prompt": true,
    },
  },
  traffic: { enabled: false },
  debugCapture: false,
  maxAgeHours: 72,
  noisyEventKinds: DEFAULT_NOISY_EVENT_KINDS,
};

export const DEFAULT_CODEX_RECORDING_CONFIG: RecordingConfig = {
  ...DEFAULT_RECORDING_CONFIG,
  taps: {
    ...DEFAULT_RECORDING_CONFIG.taps,
    categories: { ...DEFAULT_RECORDING_CONFIG.taps.categories },
  },
  traffic: { ...DEFAULT_RECORDING_CONFIG.traffic },
  noisyEventKinds: DEFAULT_CODEX_NOISY_EVENT_KINDS,
};

export function cloneRecordingConfig(config: RecordingConfig): RecordingConfig {
  return {
    taps: {
      enabled: config.taps.enabled,
      categories: { ...DEFAULT_RECORDING_CONFIG.taps.categories, ...config.taps.categories },
    },
    traffic: { enabled: config.traffic.enabled },
    debugCapture: config.debugCapture,
    maxAgeHours: config.maxAgeHours,
    noisyEventKinds: [...config.noisyEventKinds],
  };
}

export function defaultRecordingConfig(cli: CliKind = "claude"): RecordingConfig {
  return cloneRecordingConfig(cli === "codex" ? DEFAULT_CODEX_RECORDING_CONFIG : DEFAULT_RECORDING_CONFIG);
}

export function ensureNoisyEventKind(config: RecordingConfig, kind: string): RecordingConfig {
  if (config.noisyEventKinds.includes(kind)) return config;
  return {
    ...config,
    noisyEventKinds: [...config.noisyEventKinds, kind].sort(),
  };
}

export function mergeRecordingConfig(base: RecordingConfig, patch: Partial<RecordingConfig>): RecordingConfig {
  return {
    ...base,
    ...patch,
    taps: patch.taps
      ? {
          ...base.taps,
          ...patch.taps,
          categories: {
            ...base.taps.categories,
            ...(patch.taps.categories ?? {}),
          },
        }
      : base.taps,
    traffic: patch.traffic ? { ...base.traffic, ...patch.traffic } : base.traffic,
    noisyEventKinds: patch.noisyEventKinds ? [...patch.noisyEventKinds] : base.noisyEventKinds,
  };
}

export const DEFAULT_RECORDING_CONFIGS_BY_CLI: RecordingConfigsByCli = {
  claude: defaultRecordingConfig(),
  codex: defaultRecordingConfig("codex"),
};

export function getRecordingConfigForCliFromState(
  state: {
    recordingConfig: RecordingConfig;
    recordingConfigsByCli?: Partial<RecordingConfigsByCli>;
  },
  cli: CliKind,
): RecordingConfig {
  return state.recordingConfigsByCli?.[cli] ?? state.recordingConfig;
}
