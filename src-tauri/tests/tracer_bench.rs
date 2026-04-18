//! Benchmark the per-event cost of the Linux tracer using a fixed,
//! known-volume workload (the /tmp/openat_bench C program, which does
//! N openat(O_RDONLY) calls on /etc/os-release).
//!
//! Run with:
//!   cargo test --test tracer_bench --release -- --nocapture --ignored
//!
//! Reports: native wall time, traced wall time, events emitted,
//! per-event overhead (ns).

#![cfg(target_os = "linux")]

use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use claude_tabs_lib::tracer::event::FsEvent;
use claude_tabs_lib::tracer::linux::{install_in_pre_exec, spawn_with_tracer};

const BENCH_BIN: &str = "/tmp/openat_bench";

fn run_native(n: u32) -> u128 {
    let t0 = Instant::now();
    let status = Command::new(BENCH_BIN)
        .arg(n.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("run native bench");
    let elapsed = t0.elapsed().as_nanos();
    assert!(status.success(), "native bench failed");
    elapsed
}

fn run_traced(n: u32) -> (u128, u64) {
    let counter = Arc::new(AtomicU64::new(0));
    let counter_sink = counter.clone();
    let mut cmd = Command::new(BENCH_BIN);
    cmd.arg(n.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    unsafe {
        cmd.pre_exec(|| install_in_pre_exec());
    }

    let (exit_tx, exit_rx) = std::sync::mpsc::channel::<u32>();
    let t0 = Instant::now();
    let (_pid, handle) = spawn_with_tracer(
        cmd,
        "bench-tab".to_string(),
        Box::new(move |_ev: &FsEvent| {
            counter_sink.fetch_add(1, Ordering::Relaxed);
        }),
        exit_tx,
    )
    .expect("spawn_with_tracer");

    // Wait for the benchmark to exit via the tracer's exit channel.
    let _ = exit_rx.recv_timeout(std::time::Duration::from_secs(60));
    let elapsed = t0.elapsed().as_nanos();
    drop(handle);
    (elapsed, counter.load(Ordering::Relaxed))
}

#[test]
#[ignore]
fn bench_openat_per_event_cost() {
    if !Path::new(BENCH_BIN).exists() {
        panic!(
            "{} missing; build it with:\n  gcc -O2 -o {} tests/openat_bench.c",
            BENCH_BIN, BENCH_BIN
        );
    }

    // Warm caches.
    let _ = run_native(100);
    let _ = run_traced(100);

    for &n in &[1_000u32, 5_000, 10_000] {
        // Median of 3 runs each.
        let mut native_times = Vec::new();
        let mut traced_times = Vec::new();
        let mut event_counts = Vec::new();
        for _ in 0..3 {
            native_times.push(run_native(n));
            let (t, c) = run_traced(n);
            traced_times.push(t);
            event_counts.push(c);
        }
        native_times.sort();
        traced_times.sort();
        event_counts.sort();
        let native = native_times[1];
        let traced = traced_times[1];
        let events = event_counts[1];

        let overhead_ns = traced.saturating_sub(native);
        let per_event_ns = if events > 0 {
            overhead_ns as u64 / events
        } else {
            0
        };
        println!(
            "N={n:>6}  native={:>10} ns  traced={:>10} ns  events={:>6}  overhead={:>10} ns  per_event={:>6} ns",
            native, traced, events, overhead_ns, per_event_ns
        );
    }
}
