---
paths:
  - "src/lib/inspectorPort.ts"
  - "src/hooks/useInspectorConnection.ts"
---

# Inspector Connection

<!-- Codes: SI=State Inspection, IN=Inspector -->

- [SI-02] Inspector connects immediately; retries up to 30x at 100ms intervals (~3s total) for initial connection (Bun init time). After established connection drops, reconnects with backoff delays [2s, 4s, 8s]. everConnectedRef distinguishes initial connect vs reconnect.
  - Files: src/hooks/useInspectorConnection.ts

- [IN-01] Inspector port allocation and registry in `inspectorPort.ts`. Async `allocateInspectorPort()` probes OS via `check_port_available` IPC (Rust TcpListener::bind) and skips registry-held ports.
  - Files: src/lib/inspectorPort.ts

- [IN-07] Inspector port allocator verifies each candidate port is free via `check_port_available` IPC (Rust TcpListener::bind on 127.0.0.1). Skips ports already in the registry. Throws if all 100 ports (6400-6499) are exhausted.
  - Files: src/lib/inspectorPort.ts, src-tauri/src/commands.rs

- [IN-12] useInspectorConnection.ts: WebSocket lifecycle only (connect, Runtime.evaluate for hook injection, retry, disconnect). No state derivation. useTapPipeline.ts: receives `tap-entry-{sessionId}` Tauri events from Rust TCP tap server, classifies, dispatches to bus, buffers for disk. useTapEventProcessor.ts: subscribes to bus, runs reducers, calls store actions.
  - Files: src/hooks/useInspectorConnection.ts, src/hooks/useTapPipeline.ts, src/hooks/useTapEventProcessor.ts
