//! Reproduces "tracer: spawn thread timed out" by calling spawn_with_tracer
//! while many background threads are actively allocating. If the seccomp
//! filter is built inside pre_exec (child context), at least one fork
//! should deadlock on an inherited allocator lock.

#![cfg(target_os = "linux")]

use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use claude_tabs_lib::tracer::event::FsEvent;
use claude_tabs_lib::tracer::linux::{install_in_pre_exec, spawn_with_tracer};

fn main() {}

#[test]
fn spawn_survives_concurrent_allocator_pressure() {
    let stop = Arc::new(AtomicBool::new(false));
    let mut workers = Vec::new();
    for i in 0..8 {
        let stop = stop.clone();
        workers.push(std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                let mut v: Vec<u8> = Vec::with_capacity(256 + (i * 137) % 4096);
                v.extend((0..v.capacity()).map(|n| n as u8));
                let len = v.len();
                std::mem::drop(v);
                let s = format!("worker-{i}-{len}");
                std::hint::black_box(s);
            }
        }));
    }

    let mut failures = 0;
    for round in 0..20 {
        let target = std::env::temp_dir().join(format!("stress-{}-{round}.txt", std::process::id()));
        std::fs::write(&target, "hi").unwrap();
        let mut cmd = Command::new("/bin/cat");
        cmd.arg(&target).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        unsafe { cmd.pre_exec(|| install_in_pre_exec()); }
        let events: Arc<Mutex<Vec<FsEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let events_sink = events.clone();
        let (exit_tx, _exit_rx) = std::sync::mpsc::channel::<u32>();
        let start = Instant::now();
        match spawn_with_tracer(cmd, format!("tab-{round}"), Box::new(move |ev| { events_sink.lock().unwrap().push(ev.clone()); }), exit_tx) {
            Ok((pid, handle)) => {
                let elapsed = start.elapsed();
                println!("round {round}: OK pid={pid} elapsed={}ms", elapsed.as_millis());
                std::thread::sleep(Duration::from_millis(50));
                drop(handle);
            }
            Err(e) => {
                failures += 1;
                println!("round {round}: FAIL after {}ms: {e}", start.elapsed().as_millis());
            }
        }
        let _ = std::fs::remove_file(&target);
    }

    stop.store(true, Ordering::Relaxed);
    for w in workers { let _ = w.join(); }
    println!("total failures: {failures}/20");
    assert_eq!(failures, 0, "{failures}/20 spawns failed/timed out");
}
