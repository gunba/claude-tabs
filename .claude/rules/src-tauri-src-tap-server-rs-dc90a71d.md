---
paths:
  - "src-tauri/src/tap_server.rs"
---

# src-tauri/src/tap_server.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Inspector Tap Pipeline

- [IN-33 L134] Backend tap_server.rs batches JSONL lines into a single Tauri event per session: BufReader pulls the first line, then drains any extra lines already in the BufReader buffer (reader.buffer().contains(b'\n')) up to TAP_EMIT_BATCH_MAX_LINES=128 / TAP_EMIT_BATCH_MAX_BYTES=256KB. emit_tap_batch sends batch[0] alone if the batch holds 1 line, else batch.join("\n"). Frontend useTapPipeline splits the payload on "\n", trims, JSON.parses each non-empty line, and dispatches via tapEventBus.dispatchBatch (per-session — events delivered as a group to each subscriber). The blocking accept loop is unblocked at shutdown by wake_tap_listener (TcpStream::connect to 127.0.0.1:port from stop_all/stop_session); previously a 100ms WouldBlock sleep loop polled the stop flag.
  - tap_server.rs:L93 entry point; wake_tap_listener at L51; push_tap_line at L82; emit_tap_batch at L91. Frontend split + dispatchBatch at src/hooks/useTapPipeline.ts:L138. tapEventBus.dispatchBatch at src/lib/tapEventBus.ts:L37.
