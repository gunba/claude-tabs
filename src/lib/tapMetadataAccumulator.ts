import type { TapEvent } from "../types/tapEvents";
import type { SessionMetadata } from "../types/session";

/**
 * Stateful accumulator: processes tap events and produces metadata diffs.
 * One instance per session. Fingerprint-based diffing — only returns changes.
 */
export class TapMetadataAccumulator {
  private costUsd = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private runtimeModel: string | null = null;
  private currentToolName: string | null = null;
  private currentAction: string | null = null;
  private nodeSummary: string | null = null;
  private assistantMessageCount = 0;
  private choiceHint = false;
  private lastFingerprint = "";
  // Context tracking
  private lastCacheRead = 0;
  // Duration tracking (wall-clock from TurnDuration, fallback to API time)
  private durationMs = 0;
  // API region + request ID
  private apiRegion: string | null = null;
  private lastRequestId: string | null = null;
  // API request structure
  private systemPromptLength = 0;
  private toolCount = 0;
  private conversationLength = 0;
  // Subscription tier
  private subscriptionType: string | null = null;
  // Hook/transient status
  private hookStatus: string | null = null;
  // Per-turn cost + TTFT
  private lastTurnCostUsd = 0;
  private lastTurnTtftMs = 0;
  // Active subprocess
  private activeSubprocess: string | null = null;
  // Files touched
  private filesTouched = new Set<string>();
  // Rate limits
  private rateLimitRemaining: string | null = null;
  private rateLimitReset: string | null = null;

  /** Process an event and return a metadata diff, or null if unchanged. */
  process(event: TapEvent): Partial<SessionMetadata> | null {
    switch (event.kind) {
      case "ApiTelemetry":
        this.costUsd += event.costUSD;
        this.inputTokens += event.inputTokens + event.cachedInputTokens;
        this.outputTokens += event.outputTokens;
        // Duration accumulated from TurnDuration (wall-clock), not here (API-only).
        // ApiTelemetry.durationMs is API time only; TurnDuration includes tool execution + permission waits.
        // Fallback: if no TurnDuration ever fires, durationSecs stays 0 — acceptable.
        this.lastTurnCostUsd = event.costUSD;
        this.lastTurnTtftMs = event.ttftMs;
        if (event.model) this.runtimeModel = event.model;
        break;

      case "TurnStart":
        if (event.model) this.runtimeModel = event.model;
        this.lastCacheRead = event.cacheRead;
        this.hookStatus = null;
        this.activeSubprocess = null;
        break;

      case "ToolCallStart":
        this.currentToolName = event.toolName;
        if (event.toolName === "AskUserQuestion") this.choiceHint = true;
        break;

      case "ToolInput": {
        this.currentAction = event.toolName + ": " + String(
          event.input.command || event.input.file_path || event.input.pattern ||
          event.input.description || event.input.query || ""
        ).slice(0, 80);
        // Track file paths for Edit/Write/Read
        const fp = event.input.file_path;
        if (typeof fp === "string" && (event.toolName === "Edit" || event.toolName === "Write" || event.toolName === "Read")) {
          this.filesTouched.add(fp);
        }
        break;
      }

      case "UserInput":
        if (!this.nodeSummary) {
          this.nodeSummary = event.display.slice(0, 200);
        }
        this.currentToolName = null;
        this.currentAction = null;
        this.choiceHint = false;
        this.hookStatus = null;
        this.activeSubprocess = null;
        break;

      case "SlashCommand":
        if (!this.nodeSummary) {
          this.nodeSummary = event.display.slice(0, 200);
        }
        this.currentToolName = null;
        this.currentAction = null;
        this.choiceHint = false;
        this.hookStatus = null;
        this.activeSubprocess = null;
        break;

      case "ConversationMessage":
        if (event.messageType === "assistant" && !event.isSidechain) {
          this.assistantMessageCount++;
          if (event.toolAction) this.currentAction = event.toolAction;
          if (event.toolNames.length > 0) {
            this.currentToolName = event.toolNames[event.toolNames.length - 1];
          }
        }
        if (event.messageType === "user" && !event.isSidechain && event.textSnippet) {
          if (!this.nodeSummary) {
            this.nodeSummary = event.textSnippet.slice(0, 200);
          }
        }
        // Tool errors → transient status
        if (event.hasToolError && event.toolErrorText) {
          this.hookStatus = "Error: " + event.toolErrorText.slice(0, 60);
        }
        break;

      case "TurnEnd":
        if (event.stopReason === "end_turn") {
          this.currentToolName = null;
          this.currentAction = null;
          this.choiceHint = false;
          this.activeSubprocess = null;
        }
        break;

      case "PermissionApproved":
      case "PermissionRejected":
        this.choiceHint = false;
        break;

      // API region from cf-ray header
      case "ApiFetch":
        if (event.cfRay) {
          const dash = event.cfRay.lastIndexOf("-");
          if (dash > 0) this.apiRegion = event.cfRay.slice(dash + 1);
        }
        if (event.requestId) this.lastRequestId = event.requestId;
        if (event.rateLimitRemaining) this.rateLimitRemaining = event.rateLimitRemaining;
        if (event.rateLimitReset) this.rateLimitReset = event.rateLimitReset;
        break;

      // API request structure
      case "ApiRequestInfo":
        this.systemPromptLength = event.systemLength;
        this.toolCount = event.toolCount;
        this.conversationLength = event.messageCount;
        break;

      // Subscription tier
      case "AccountInfo":
        this.subscriptionType = event.subscriptionType;
        break;

      // Hook progress
      case "HookProgress":
        this.hookStatus = event.statusMessage || event.command || null;
        break;

      // Rate limit warning
      case "RateLimit":
        if (event.status === "allowed_warning") {
          this.hookStatus = `Rate limit warning — resets in ${event.hoursTillReset}h`;
        }
        break;

      // Subprocess spawn → active indicator
      case "SubprocessSpawn": {
        const cmd = event.cmd;
        // Extract a short label: last path segment + eval'd command if bash
        const evalMatch = cmd.match(/eval '([^']+)'/);
        if (evalMatch) {
          this.activeSubprocess = evalMatch[1].slice(0, 40);
        } else {
          const parts = cmd.split(/[\\/]/);
          const exe = parts[parts.length - 1]?.split(" ")[0] || cmd.slice(0, 30);
          this.activeSubprocess = exe;
        }
        break;
      }

      // File history snapshot → merge into filesTouched
      case "FileHistorySnapshot":
        for (const p of event.filePaths) {
          this.filesTouched.add(p);
        }
        break;

      // Turn duration (wall-clock) → replace API-only duration
      case "TurnDuration":
        // TurnDuration gives wall-clock time (includes tool exec, permission waits)
        // More accurate than summing ApiTelemetry.durationMs
        this.durationMs += event.durationMs;
        break;

      default:
        return null;
    }

    return this.diff();
  }

  /** Return metadata if changed since last call, otherwise null. */
  private diff(): Partial<SessionMetadata> | null {
    const contextPercent = this.lastCacheRead > 0
      ? Math.min(99, Math.round((this.lastCacheRead / 200000) * 100))
      : 0;

    const metadata: Partial<SessionMetadata> = {
      costUsd: this.costUsd,
      contextPercent,
      durationSecs: Math.floor(this.durationMs / 1000),
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      currentAction: this.currentAction,
      currentToolName: this.currentToolName,
      choiceHint: this.choiceHint,
      runtimeModel: this.runtimeModel,
      assistantMessageCount: this.assistantMessageCount,
      apiRegion: this.apiRegion,
      lastRequestId: this.lastRequestId,
      subscriptionType: this.subscriptionType,
      hookStatus: this.hookStatus,
      lastTurnCostUsd: this.lastTurnCostUsd,
      lastTurnTtftMs: this.lastTurnTtftMs,
      systemPromptLength: this.systemPromptLength,
      toolCount: this.toolCount,
      conversationLength: this.conversationLength,
      activeSubprocess: this.activeSubprocess,
      filesTouched: [...this.filesTouched],
      rateLimitRemaining: this.rateLimitRemaining,
      rateLimitReset: this.rateLimitReset,
      ...(this.nodeSummary ? { nodeSummary: this.nodeSummary } : {}),
    };

    const fp = JSON.stringify(metadata);
    if (fp === this.lastFingerprint) return null;
    this.lastFingerprint = fp;
    return metadata;
  }

  /** Reset all accumulated state. */
  reset(): void {
    this.costUsd = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.runtimeModel = null;
    this.currentToolName = null;
    this.currentAction = null;
    this.nodeSummary = null;
    this.assistantMessageCount = 0;
    this.choiceHint = false;
    this.lastFingerprint = "";
    this.lastCacheRead = 0;
    this.durationMs = 0;
    this.apiRegion = null;
    this.lastRequestId = null;
    this.systemPromptLength = 0;
    this.toolCount = 0;
    this.conversationLength = 0;
    this.subscriptionType = null;
    this.hookStatus = null;
    this.lastTurnCostUsd = 0;
    this.lastTurnTtftMs = 0;
    this.activeSubprocess = null;
    this.filesTouched.clear();
    this.rateLimitRemaining = null;
    this.rateLimitReset = null;
  }
}
