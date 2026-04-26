use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{
    CpuRefreshKind, Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::ActivePids;

const POLL_INTERVAL: Duration = Duration::from_millis(1000);
const TOP_CHILD_LIMIT: usize = 5;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProcessMetricsPayload {
    pid: u32,
    parent_cpu: f32,
    parent_mem: u64,
    children_cpu: f32,
    children_mem: u64,
    child_count: u32,
    top_children: Vec<ChildProcessMetrics>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OverallMetricsPayload {
    cpu: f32,
    mem: u64,
    processes: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppProcessMetricsPayload {
    pid: u32,
    cpu: f32,
    mem: u64,
    children_cpu: f32,
    children_mem: u64,
    child_count: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChildProcessMetrics {
    pid: u32,
    name: String,
    command: String,
    mem: u64,
}

struct ProcessTreeSummary {
    cpu: f32,
    mem: u64,
    count: u32,
    top_children: Vec<ChildProcessMetrics>,
}

/// [PM-02] spawn_collector: background thread polling sysinfo every 1000ms when active PIDs exist; CpuRefreshKind::nothing() primes cpu count immediately; CPU% normalized by cpu_count
/// [PM-04] Per-tick: parent->children HashMap O(N) build; sum_descendants BFS cycle-safe; emits process-metrics / app-process-metrics / process-metrics-overall per tick
/// [PM-05] Overall real-root dedup: skips tracked PIDs whose ancestor is also tracked; bails on try_state None or poisoned lock
/// Spawn the per-tab CPU/memory poller. Runs for the lifetime of the app.
/// Reads tracked PIDs from `ActivePids` (registered by the frontend on PTY spawn),
/// walks the full descendant tree, and emits two Tauri events per tick:
///   - `process-metrics` — one event per tracked parent PID
///   - `process-metrics-overall` — single sum across all tracked trees
pub fn spawn_collector(app: AppHandle) {
    thread::spawn(move || {
        let mut system = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing())
                .with_processes(process_refresh_kind()),
        );
        // `with_cpu` populates the CPU list so `cpus().len()` is the logical count.
        let cpu_count = system.cpus().len().max(1) as f32;
        let app_pid = std::process::id();
        let mut had_tracked_processes = false;

        loop {
            thread::sleep(POLL_INTERVAL);

            let tracked: Vec<u32> = match app.try_state::<ActivePids>() {
                Some(state) => match state.0.lock() {
                    Ok(set) => set.iter().copied().collect(),
                    Err(_) => continue,
                },
                None => continue,
            };

            if tracked.is_empty() {
                if had_tracked_processes {
                    had_tracked_processes = false;
                    let _ = app.emit(
                        "process-metrics-overall",
                        OverallMetricsPayload {
                            cpu: 0.0,
                            mem: 0,
                            processes: 0,
                        },
                    );
                }
                continue;
            }
            had_tracked_processes = true;

            system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                process_refresh_kind(),
            );

            // Build parent → children index once per tick (O(N) instead of O(N²) per BFS).
            let mut children_of: HashMap<u32, Vec<u32>> = HashMap::new();
            for (pid, process) in system.processes() {
                if let Some(parent) = process.parent() {
                    children_of
                        .entry(parent.as_u32())
                        .or_default()
                        .push(pid.as_u32());
                }
            }

            if let Some(app_proc) = system.process(Pid::from_u32(app_pid)) {
                let children = sum_descendants(&system, &children_of, app_pid);
                let _ = app.emit(
                    "app-process-metrics",
                    AppProcessMetricsPayload {
                        pid: app_pid,
                        cpu: app_proc.cpu_usage() / cpu_count,
                        mem: app_proc.memory(),
                        children_cpu: children.cpu / cpu_count,
                        children_mem: children.mem,
                        child_count: children.count,
                    },
                );
            }

            let mut overall_cpu: f32 = 0.0;
            let mut overall_mem: u64 = 0;
            let mut overall_proc_count: u32 = 0;

            // A tracked PID that is a descendant of another tracked PID would
            // otherwise be counted twice in the overall sum. Skip it for
            // overall accumulation but still emit its per-root payload.
            let tracked_set: HashSet<u32> = tracked.iter().copied().collect();
            let is_real_root = |pid: u32| {
                let mut current = system
                    .process(Pid::from_u32(pid))
                    .and_then(|p| p.parent())
                    .map(|pid| pid.as_u32());
                while let Some(p) = current {
                    if tracked_set.contains(&p) {
                        return false;
                    }
                    current = system
                        .process(Pid::from_u32(p))
                        .and_then(|pp| pp.parent())
                        .map(|pid| pid.as_u32());
                }
                true
            };

            for root_pid in &tracked {
                let root_pid = *root_pid;
                let Some(parent_proc) = system.process(Pid::from_u32(root_pid)) else {
                    continue;
                };
                let parent_cpu = parent_proc.cpu_usage();
                let parent_mem = parent_proc.memory();
                let children = sum_descendants(&system, &children_of, root_pid);

                if is_real_root(root_pid) {
                    overall_cpu += parent_cpu + children.cpu;
                    overall_mem += parent_mem + children.mem;
                    overall_proc_count += 1 + children.count;
                }

                let payload = ProcessMetricsPayload {
                    pid: root_pid,
                    parent_cpu: parent_cpu / cpu_count,
                    parent_mem,
                    children_cpu: children.cpu / cpu_count,
                    children_mem: children.mem,
                    child_count: children.count,
                    top_children: children.top_children,
                };
                let _ = app.emit("process-metrics", payload);
            }

            let overall = OverallMetricsPayload {
                cpu: overall_cpu / cpu_count,
                mem: overall_mem,
                processes: overall_proc_count,
            };
            let _ = app.emit("process-metrics-overall", overall);
        }
    });
}

// [PM-08] without_tasks() prevents Linux thread RSS double-count; top_children top-5 by mem in per-session payload
fn process_refresh_kind() -> ProcessRefreshKind {
    // Linux tasks are threads in sysinfo; counting them as descendants multiplies RSS.
    ProcessRefreshKind::nothing()
        .with_cpu()
        .with_memory()
        .with_cmd(UpdateKind::OnlyIfNotSet)
        .without_tasks()
}

fn sum_descendants(
    system: &System,
    children_of: &HashMap<u32, Vec<u32>>,
    root_pid: u32,
) -> ProcessTreeSummary {
    let mut children_cpu: f32 = 0.0;
    let mut children_mem: u64 = 0;
    let mut child_count: u32 = 0;
    let mut top_children: Vec<ChildProcessMetrics> = Vec::new();
    let mut queue: Vec<u32> = children_of.get(&root_pid).cloned().unwrap_or_default();
    let mut visited: HashSet<u32> = HashSet::new();
    visited.insert(root_pid);
    while let Some(pid) = queue.pop() {
        if !visited.insert(pid) {
            continue;
        }
        if let Some(proc_info) = system.process(Pid::from_u32(pid)) {
            children_cpu += proc_info.cpu_usage();
            let mem = proc_info.memory();
            children_mem += mem;
            child_count += 1;
            push_top_child(
                &mut top_children,
                pid,
                proc_info.name(),
                proc_info.cmd(),
                mem,
            );
        }
        if let Some(grand) = children_of.get(&pid) {
            queue.extend(grand.iter().copied());
        }
    }
    top_children.sort_by(|a, b| b.mem.cmp(&a.mem));
    top_children.truncate(TOP_CHILD_LIMIT);
    ProcessTreeSummary {
        cpu: children_cpu,
        mem: children_mem,
        count: child_count,
        top_children,
    }
}

fn push_top_child(
    top_children: &mut Vec<ChildProcessMetrics>,
    pid: u32,
    name: &OsStr,
    cmd: &[std::ffi::OsString],
    mem: u64,
) {
    if top_children.len() < TOP_CHILD_LIMIT {
        top_children.push(ChildProcessMetrics {
            pid,
            name: os_str_to_string(name),
            command: process_command(name, cmd),
            mem,
        });
        return;
    }

    let replace_idx = top_children
        .iter()
        .enumerate()
        .min_by_key(|(_, child)| child.mem)
        .and_then(|(idx, child)| (mem > child.mem).then_some(idx));
    if let Some(idx) = replace_idx {
        top_children[idx] = ChildProcessMetrics {
            pid,
            name: os_str_to_string(name),
            command: process_command(name, cmd),
            mem,
        };
    }
}

fn os_str_to_string(value: &OsStr) -> String {
    value.to_string_lossy().into_owned()
}

fn process_command(name: &OsStr, cmd: &[std::ffi::OsString]) -> String {
    let joined = cmd
        .iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ");
    let label = if joined.trim().is_empty() {
        os_str_to_string(name)
    } else {
        joined
    };
    if label.chars().count() > 160 {
        format!("{}...", label.chars().take(157).collect::<String>())
    } else {
        label
    }
}
