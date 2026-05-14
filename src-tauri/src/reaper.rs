//! Linux child-process reaper.
//!
//! `lib.rs` calls `prctl(PR_SET_CHILD_SUBREAPER)` so that when a PTY child
//! (a `claude` / `codex` CLI) exits, the MCP servers and other helpers it
//! spawned reparent to *us* instead of to init. A subreaper MUST then
//! `wait()` on those reparented orphans — otherwise they linger as zombie
//! processes for the entire lifetime of the app (observed: 200+ defunct
//! `ato-mcp` entries after a long session).
//!
//! This module is that reaper. A dedicated thread blocks on a `signalfd`
//! for `SIGCHLD` and drains `waitpid(-1, WNOHANG)` on every wakeup:
//!
//!   * Orphan grandchildren — reaped and discarded (the reaping *is* the
//!     whole job for them).
//!   * PTY children that `pty::unix` registered via [`expect`] — their
//!     exit status is stashed so [`recover`] can hand it back to
//!     `UnixPty::wait()` in the rare case the reaper's `waitpid(-1)` wins
//!     the race against std's `Child::wait()` (which then returns
//!     `ECHILD`).
//!
//! SIGCHLD is blocked process-wide so it is delivered only via the
//! signalfd; `pty::unix` unblocks it again in the child's `pre_exec` so
//! spawned CLIs keep normal child-reaping behaviour.
//!
//! Linux-only. On other platforms every function is a no-op — Windows
//! relies on the Job Object (`KILL_ON_JOB_CLOSE`) set up in `lib.rs`.

#[cfg(target_os = "linux")]
mod imp {
    use std::collections::HashMap;
    use std::sync::{Condvar, Mutex, OnceLock};
    use std::time::{Duration, Instant};

    /// Per-PTY-child slot. `Pending` until the child exits; `Exited` once
    /// the reaper has waited on it and stashed the raw status.
    enum Slot {
        Pending,
        Exited(libc::c_int),
    }

    struct Reaper {
        slots: Mutex<HashMap<i32, Slot>>,
        cv: Condvar,
    }

    static REAPER: OnceLock<Reaper> = OnceLock::new();

    fn reaper() -> &'static Reaper {
        REAPER.get_or_init(|| Reaper {
            slots: Mutex::new(HashMap::new()),
            cv: Condvar::new(),
        })
    }

    /// Block `SIGCHLD` process-wide and start the signalfd reaper thread.
    /// Called once at startup, right after `PR_SET_CHILD_SUBREAPER`.
    pub fn start() {
        reaper(); // force-init the stash before the reaper thread can run

        let sfd = unsafe {
            let mut set: libc::sigset_t = std::mem::zeroed();
            libc::sigemptyset(&mut set);
            libc::sigaddset(&mut set, libc::SIGCHLD);
            // Block on this (main) thread so every thread spawned afterwards
            // inherits the mask — SIGCHLD then reaches us only via the fd.
            if libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut()) != 0 {
                log::error!(
                    "child-reaper: pthread_sigmask(SIG_BLOCK, SIGCHLD) failed: {}",
                    std::io::Error::last_os_error()
                );
                return;
            }
            let fd = libc::signalfd(-1, &set, libc::SFD_CLOEXEC);
            if fd < 0 {
                log::error!(
                    "child-reaper: signalfd failed: {}",
                    std::io::Error::last_os_error()
                );
                return;
            }
            fd
        };

        if let Err(e) = std::thread::Builder::new()
            .name("child-reaper".into())
            .spawn(move || reaper_loop(sfd))
        {
            log::error!("child-reaper: failed to spawn reaper thread: {e}");
            unsafe { libc::close(sfd) };
        }
    }

    /// Register a PTY child PID so the reaper stashes its exit status for
    /// recovery instead of discarding it. Call right after spawning.
    pub fn expect(pid: u32) {
        reaper()
            .slots
            .lock()
            .unwrap()
            .insert(pid as i32, Slot::Pending);
    }

    /// Drop a PTY child PID — the caller's own `Child::wait()` won the race
    /// and already has the status, so the reaper need not track it.
    pub fn forget(pid: u32) {
        reaper().slots.lock().unwrap().remove(&(pid as i32));
    }

    /// Recover the raw `waitpid` status of a PTY child the reaper waited on
    /// before the caller's `Child::wait()` could (which then got `ECHILD`).
    /// Blocks until the reaper stashes it, capped at a few seconds so a
    /// missing/wedged reaper thread surfaces as an error rather than a hang.
    pub fn recover(pid: u32) -> Option<libc::c_int> {
        let pid = pid as i32;
        let r = reaper();
        let mut slots = r.slots.lock().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(Slot::Exited(status)) = slots.get(&pid) {
                let status = *status;
                slots.remove(&pid);
                return Some(status);
            }
            let now = Instant::now();
            if now >= deadline {
                slots.remove(&pid);
                return None;
            }
            let (guard, _) = r.cv.wait_timeout(slots, deadline - now).unwrap();
            slots = guard;
        }
    }

    fn reaper_loop(sfd: libc::c_int) {
        // A child may already have exited between the sigmask and now.
        drain();
        let mut buf = [0u8; std::mem::size_of::<libc::signalfd_siginfo>()];
        loop {
            let n = unsafe {
                libc::read(
                    sfd,
                    buf.as_mut_ptr() as *mut libc::c_void,
                    buf.len(),
                )
            };
            if n < 0 {
                let err = std::io::Error::last_os_error();
                if err.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                log::error!("child-reaper: signalfd read failed: {err}");
                unsafe { libc::close(sfd) };
                return;
            }
            // One or more SIGCHLDs coalesced into this wakeup — drain every
            // child that has exited, regardless of how many siginfo structs
            // were queued.
            drain();
        }
    }

    /// `waitpid(-1, WNOHANG)` until no more children have exited. PTY
    /// children get their status stashed; orphan grandchildren are simply
    /// reaped and dropped.
    fn drain() {
        loop {
            let mut status: libc::c_int = 0;
            let pid = unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) };
            // 0  => children exist but none have exited
            // -1 => ECHILD (no children at all) or an error
            if pid <= 0 {
                break;
            }
            let r = reaper();
            let mut slots = r.slots.lock().unwrap();
            if let Some(slot) = slots.get_mut(&pid) {
                *slot = Slot::Exited(status);
                r.cv.notify_all();
            }
            // pid absent from the map => orphan grandchild: already reaped
            // by the waitpid above, nothing to stash.
        }
    }
}

#[cfg(not(target_os = "linux"))]
mod imp {
    // Non-Linux: no subreaper, no signalfd. Windows uses the Job Object in
    // `lib.rs`; these stubs just keep `crate::reaper::*` call sites (in the
    // `cfg(unix)` PTY backend) compiling everywhere.
    pub fn start() {}
    pub fn expect(_pid: u32) {}
    pub fn forget(_pid: u32) {}
    pub fn recover(_pid: u32) -> Option<std::os::raw::c_int> {
        None
    }
}

pub use imp::{expect, forget, recover, start};
