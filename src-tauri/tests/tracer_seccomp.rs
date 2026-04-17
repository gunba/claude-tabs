//! Integration test: verifies the Linux seccomp-bpf filter is actually
//! installed when `install_seccomp_only` is called in the current
//! thread/process, so the parent's ptrace tracer will receive
//! SECCOMP_RET_TRACE stops for file syscalls.
//!
//! We cannot test `install_in_pre_exec` via a spawned child without a
//! real ptrace tracer attached: SECCOMP_RET_TRACE returns -ENOSYS when
//! no tracer is present, which would kill any dynamically-linked
//! binary during library load. The production spawn path in
//! `pty/unix.rs` calls `PTRACE_TRACEME` inside pre_exec and the parent
//! immediately `waitpid`s + `PTRACE_SETOPTIONS` after spawn, so the
//! tracer is attached before the exec'd image runs its first syscall.
//!
//! This test forks a child (manually, not via Command) and calls
//! `install_seccomp_only` in the child WITHOUT exec, then has the
//! child verify its own seccomp mode via `prctl(PR_GET_SECCOMP)`
//! (which isn't in the filter's trace list). The child exits with
//! code 0 if the mode is 2 (filter mode), 1 otherwise. No dynamic
//! linker runs, so no filtered syscalls are triggered.

#![cfg(target_os = "linux")]

#[test]
fn seccomp_filter_install_sets_mode_2() {
    let pid = unsafe { libc::fork() };
    assert!(pid >= 0, "fork failed: {}", std::io::Error::last_os_error());

    if pid == 0 {
        // Child
        let exit_code =
            match claude_tabs_lib::tracer::linux::install_seccomp_only() {
                Ok(()) => {
                    let mode = unsafe {
                        libc::prctl(libc::PR_GET_SECCOMP, 0, 0, 0, 0)
                    };
                    if mode == 2 {
                        0
                    } else {
                        2
                    }
                }
                Err(_) => 3,
            };
        unsafe {
            libc::_exit(exit_code);
        }
    }

    // Parent
    let mut status: libc::c_int = 0;
    let ret = unsafe { libc::waitpid(pid, &mut status, 0) };
    assert_eq!(ret, pid);
    assert!(
        libc::WIFEXITED(status),
        "child did not exit normally: status={}",
        status
    );
    let code = libc::WEXITSTATUS(status);
    assert_eq!(
        code, 0,
        "child reported seccomp install failure (code {})",
        code
    );
}
