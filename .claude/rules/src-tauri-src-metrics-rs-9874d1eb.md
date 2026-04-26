---
paths:
  - "src-tauri/src/metrics.rs"
---

# src-tauri/src/metrics.rs

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Process Metrics Collector

- [PM-02 L64] spawn_collector(app) runs a dedicated background thread polling sysinfo every 1000ms. System initialized with RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing()).with_processes(...), so cpus().len() returns the logical CPU count immediately without a System::new_all() fallback. CPU% is normalized by cpu_count to match Task Manager / Activity Monitor semantics (100% = one full core).
- [PM-04 L65] Per-tick: build a parent -> children HashMap once over all processes (O(N)), then for each tracked root PID walk descendants via sum_descendants BFS (cycle-safe via a visited HashSet). Emits three Tauri events per tick: 'process-metrics' per tracked root PID (parentCpu/parentMem + childrenCpu/childrenMem/childCount), 'app-process-metrics' for the host app PID, 'process-metrics-overall' summing all real-root trees.
- [PM-05 L66] Real roots for overall sum: a tracked PID is excluded from overall accumulation if any ancestor is also tracked (ancestor-walk up the parent chain against a HashSet of tracked PIDs). This prevents double-counting nested process trees in the overall sum while still emitting the per-root 'process-metrics' event for every tracked PID. Bails silently if ActivePids try_state returns None or the Mutex is poisoned.
- [PM-08 L205] process_refresh_kind() helper applies ProcessRefreshKind::nothing().with_cpu().with_memory().with_cmd(UpdateKind::OnlyIfNotSet).without_tasks(). without_tasks() prevents sysinfo from counting Linux task threads as descendants — without it, sum_descendants would multiply RSS by thread count for multi-threaded children. ProcessTreeSummary.top_children carries the 5 largest descendants by memory (pid, name, command, mem) on each per-session payload; StatusBar tooltip lists them in the CPU/mem chip hover so users can see which child is responsible for high memory. process_command joins cmd[] with spaces, falls back to name(), truncates at 160 chars.
  - src-tauri/src/metrics.rs:L195 (process_refresh_kind), src-tauri/src/metrics.rs:L204 (sum_descendants returns ProcessTreeSummary), src/components/StatusBar/StatusBar.tsx:L229 (tooltip lists top_children), src/hooks/useProcessMetrics.ts:L41 (forwards topChildren to session store), src/store/sessions.ts:L72 (ProcessTreeMetrics.topChildren)
