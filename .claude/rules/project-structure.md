# Project Structure

<!-- Codes: FS=Frontend Structure -->

- [FS-01] Frontend source tree:
  ```
  src/
  ├── main.tsx                             # React entry point, theme init
  ├── App.tsx                              # Root: tab bar, subagent bar, terminals
  ├── store/sessions.ts                    # Zustand: sessions, active tab, subagents, command history, autoRecordOnStart
  ├── store/settings.ts                    # Zustand: preferences, CLI info (persisted to localStorage)
  ├── hooks/
  │   ├── useTerminal.ts                   # xterm.js lifecycle, direct writes (DEC 2026 sync output), fixed 1M scrollback
  │   ├── usePty.ts                        # PTY spawn wrapper (uses lib/ptyProcess)
  │   ├── useInspectorConnection.ts        # BUN_INSPECT WebSocket lifecycle (connect, retry, disconnect)
  │   ├── useTapPipeline.ts                # Tap event receiver: TCP tap-entry events → classify → dispatch → disk
  │   ├── useTapEventProcessor.ts          # Tap event → store: state reducer, metadata accumulator, subagent tracker
  │   ├── useCommandDiscovery.ts           # Slash command discovery (binary scan + --help fallback + plugins)
  │   ├── useCliWatcher.ts                 # CLI version + capabilities
  │   ├── useNotifications.ts              # Desktop notifications (WinRT toast on Windows, tauri-plugin-notification on Linux)
  │   ├── useCtrlKey.ts                    # Ctrl-key held state for alternate-action highlights
  │   └── useGitStatus.ts                  # Git status polling (2s interval) with change detection
  ├── components/
  │   ├── Terminal/TerminalPanel.tsx        # PTY + terminal + inspector + background buffering
  │   ├── SessionLauncher/SessionLauncher.tsx  # New/resume session modal
  │   ├── ResumePicker/ResumePicker.tsx     # Browse past sessions to resume
  │   ├── CommandBar/CommandBar.tsx         # Slash commands with usage-based sorting
  │   ├── StatusBar/StatusBar.tsx           # Model, subscription, region, duration, hooks, subprocess
  │   ├── CommandPalette/CommandPalette.tsx # Ctrl+K search
  │   ├── SubagentInspector/SubagentInspector.tsx  # Markdown-rendered subagent conversation viewer
  │   ├── ContextViewer/ContextViewer.tsx    # System prompt context viewer modal
  │   ├── ConfigManager/ConfigManager.tsx  # 9-tab config workspace (Ctrl+,)
  │   ├── ConfigManager/ThreePaneEditor.tsx # 3-column User/Project/Local scope layout
  │   ├── ConfigManager/SettingsPane.tsx   # Per-scope JSON editor with syntax highlighting
  │   ├── ConfigManager/MarkdownPane.tsx   # Per-scope CLAUDE.md editor with preview toggle
  │   ├── ConfigManager/HooksPane.tsx      # Per-scope hooks CRUD
  │   ├── ConfigManager/PluginsPane.tsx    # CLI-driven plugin manager
  │   ├── ConfigManager/AgentEditor.tsx    # Per-scope agent file list + markdown editor
  │   ├── ConfigManager/SettingsTab.tsx    # Per-scope settings with schema-driven fields
  │   ├── ConfigManager/EnvVarsTab.tsx     # 3-pane env section editor
  │   ├── ConfigManager/EnvVarsReference.tsx  # Searchable env var reference panel
  │   ├── ConfigManager/PromptsTab.tsx     # My Prompts + Observed prompts
  │   ├── ConfigManager/SkillsEditor.tsx   # Per-scope skills file list + markdown editor
  │   ├── ConfigManager/ProvidersPane.tsx  # Multi-provider config
  │   ├── Icons/Icons.tsx                  # SVG icon components
  │   ├── PillGroup/PillGroup.tsx          # Reusable pill/chip layout component
  │   ├── ModalOverlay/ModalOverlay.tsx    # Shared modal wrapper
  │   ├── DebugPanel/DebugPanel.tsx        # Structured log viewer (Ctrl+Shift+D)
  │   ├── SearchPanel/SearchPanel.tsx      # Cross-session terminal search (Ctrl+Shift+F)
  │   └── DiffPanel/
  │       ├── DiffPanel.tsx                # Git diff side panel (Ctrl+Shift+G)
  │       └── DiffModal.tsx                # Side-by-side diff modal
  ├── lib/
  │   ├── inspectorHooks.ts                # INSTALL_TAPS JS expression for BUN_INSPECT
  │   ├── tapClassifier.ts                 # Stateless: TapEntry → TapEvent | null (~45 event types)
  │   ├── tapEventBus.ts                   # Per-session synchronous pub/sub
  │   ├── tapStateReducer.ts               # Pure: (SessionState, TapEvent) → SessionState
  │   ├── tapMetadataAccumulator.ts        # Stateful: events → Partial<SessionMetadata> diffs
  │   ├── tapSubagentTracker.ts            # Subagent lifecycle: spawn → run → complete/kill
  │   ├── inspectorPort.ts                 # Inspector port allocation and registry
  │   ├── claude.ts                        # Color assignment, model resolution, resume helpers
  │   ├── theme.ts                         # Theme definitions, CSS variable setter, xterm theme
  │   ├── ptyProcess.ts                    # Direct PTY wrapper + active PID cleanup registry
  │   ├── ptyRegistry.ts                   # Global PTY writer + kill registry
  │   ├── terminalRegistry.ts              # Terminal buffer reader, SearchAddon, scrollToLine
  │   ├── searchBuffers.ts                 # Cross-session text search
  │   ├── socks5Url.ts                     # SOCKS5 URL builder for proxy connections
  │   ├── paths.ts                         # Path helpers, normalizePath, worktree detection
  │   ├── settingsSchema.ts                # CLI settings.json schema discovery + parsing
  │   ├── envVars.ts                       # Env var catalog
  │   ├── debugLog.ts                      # Structured debug logging (dlog function)
  │   ├── uiConfig.ts                      # Persisted UI configuration
  │   ├── perfTrace.ts                     # Performance tracing utilities
  │   ├── promptDiff.ts                     # LCS line diff, regex escape, rule application, rule generation
  │   └── diffParser.ts                    # Git porcelain/numstat/unified-diff parsers
  └── types/
      ├── session.ts                       # TypeScript types mirroring Rust (camelCase)
      ├── tapEvents.ts                     # Discriminated union of ~45 tap event types
      ├── ipc.ts                           # Tauri IPC command signatures
      └── git.ts                           # Git status and diff types
  ```
