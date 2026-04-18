//! End-to-end integration test for the Linux process-tree tracer.
//!
//! Uses `spawn_with_tracer` to spawn `bash -c 'cat <target>'` with the
//! production pre_exec hook (seccomp filter + PTRACE_TRACEME). The
//! tracer runs on the same internal thread that forks, so ptrace
//! thread affinity is satisfied. Verifies at least one FsEvent with
//! path == <target> is emitted — proof that seccomp, ptrace attach,
//! syscall argument decoding, path resolution, *and* the [PO-06]
//! subprocess scope filter (which requires the file-touching pid !=
//! root_pid) all work end-to-end.
//!
//! The wrapper bash is the root; cat is a subprocess, so its openat
//! reaches on_seccomp past the scope gate.

#![cfg(target_os = "linux")]

use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use claude_tabs_lib::tracer::event::FsEvent;
use claude_tabs_lib::tracer::linux::{install_in_pre_exec, spawn_with_tracer};

/// Serialize every test in this file: each spawns its own tracer
/// thread which calls `waitpid(-1, …)`, so running two in parallel
/// inside the same cargo-test binary lets tracer A reap tracer B's
/// children and vice versa. Production doesn't hit this because each
/// PTY tab lives in its own Tauri session and each tracer thread
/// only waitpids tracees it forked.
static TEST_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn tracer_observes_cat_openat_of_target_file() {
    let _guard = TEST_LOCK.lock().unwrap();
    let target = std::env::temp_dir().join(format!(
        "tracer-e2e-{}.txt",
        std::process::id()
    ));
    std::fs::write(&target, "hello tracer\n").expect("write target");
    let target_path = target.to_string_lossy().to_string();

    // Wrap cat in bash so that bash is the root pid and cat is a
    // subprocess. The [PO-06] scope gate drops events from root_pid;
    // we need the file-touching pid to be a descendant. The `true`
    // sentinel suppresses bash's tail-call optimization (which would
    // exec cat in place and keep the same pid as bash).
    let mut cmd = Command::new("/bin/bash");
    cmd.arg("-c").arg(format!(
        "/bin/cat {}; /bin/true",
        shell_escape(&target_path)
    ));
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    unsafe {
        cmd.pre_exec(|| install_in_pre_exec());
    }

    let events: Arc<Mutex<Vec<FsEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let events_sink = events.clone();
    let (exit_tx, _exit_rx) = std::sync::mpsc::channel::<u32>();
    let (_pid, handle) = spawn_with_tracer(
        cmd,
        "test-tab".to_string(),
        Box::new(move |ev| {
            events_sink.lock().unwrap().push(ev.clone());
        }),
        exit_tx,
    )
    .expect("spawn_with_tracer");

    // Poll for the target-file event with a bounded deadline. `cat` is
    // fast (~10ms); if we don't see the event within a few seconds,
    // something's broken in the pipeline.
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut hit = false;
    while Instant::now() < deadline {
        if events
            .lock()
            .unwrap()
            .iter()
            .any(|ev| ev.path == target_path)
        {
            hit = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }

    drop(handle);

    let _ = std::fs::remove_file(&target);

    let captured = events.lock().unwrap();
    assert!(
        hit,
        "expected an FsEvent with path={:?}; captured {} events (first 20 paths: {:?})",
        target_path,
        captured.len(),
        captured
            .iter()
            .take(20)
            .map(|e| &e.path)
            .collect::<Vec<_>>()
    );
}

/// Exit channel regression test: when the tracee terminates, the
/// tracer must deliver the exit code to `exit_rx` so
/// `UnixPty::wait()` can unblock. Without this wire-up we saw a hang
/// because the tracer thread reaped via waitpid but never forwarded
/// the status anywhere.
#[test]
fn tracer_delivers_root_pid_exit_code() {
    let _guard = TEST_LOCK.lock().unwrap();
    let mut cmd = Command::new("/bin/sh");
    cmd.args(["-c", "exit 7"]);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    unsafe {
        cmd.pre_exec(|| install_in_pre_exec());
    }

    let (exit_tx, exit_rx) = std::sync::mpsc::channel::<u32>();
    let (_pid, _handle) = spawn_with_tracer(
        cmd,
        "exit-test".to_string(),
        Box::new(|_ev| {}),
        exit_tx,
    )
    .expect("spawn_with_tracer");

    let code = exit_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("exit channel did not deliver within 5s");
    assert_eq!(code, 7, "wrong exit code");
}

/// [PO-06] regression: the root pid's own file I/O must be dropped.
/// We spawn `/bin/cat` directly (cat is the root) and verify no
/// FsEvent mentions the target file, even though cat clearly openat's
/// it. Bash/descendant syscalls are tested by the main e2e above.
#[test]
fn tracer_drops_root_pid_events() {
    let _guard = TEST_LOCK.lock().unwrap();
    let target = std::env::temp_dir().join(format!(
        "tracer-root-{}.txt",
        std::process::id()
    ));
    std::fs::write(&target, "root-only\n").expect("write target");
    let target_path = target.to_string_lossy().to_string();

    let mut cmd = Command::new("/bin/cat");
    cmd.arg(&target);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    unsafe {
        cmd.pre_exec(|| install_in_pre_exec());
    }

    let events: Arc<Mutex<Vec<FsEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let events_sink = events.clone();
    let (exit_tx, exit_rx) = std::sync::mpsc::channel::<u32>();
    let (_pid, handle) = spawn_with_tracer(
        cmd,
        "root-drop".to_string(),
        Box::new(move |ev| {
            events_sink.lock().unwrap().push(ev.clone());
        }),
        exit_tx,
    )
    .expect("spawn_with_tracer");

    // Wait for cat to exit so we know every syscall has been observed.
    let _ = exit_rx.recv_timeout(Duration::from_secs(5));
    drop(handle);
    let _ = std::fs::remove_file(&target);

    let captured = events.lock().unwrap();
    let hits: Vec<_> = captured.iter().filter(|e| e.path == target_path).collect();
    assert!(
        hits.is_empty(),
        "expected no events from root pid; got {} (paths: {:?})",
        hits.len(),
        hits.iter().map(|e| &e.path).collect::<Vec<_>>()
    );
}

/// Crude shell quoting: wrap in single quotes, escape any embedded
/// single quote. Only used for well-formed temp paths, not
/// adversarial input.
fn shell_escape(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{}'", escaped)
}
