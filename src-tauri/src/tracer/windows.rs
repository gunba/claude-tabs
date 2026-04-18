/// Windows process-tree tracer via `DebugActiveProcess` + hardware
/// debug-register breakpoints.
///
/// Design
/// ------
/// x86-64 CPUs have four hardware breakpoint registers (DR0..DR3) per
/// thread that fire on execution of a specific address — Windows
/// exposes them through `SetThreadContext`. We use all four:
///
///   | DR  | Function                |
///   | --- | ----------------------- |
///   | DR0 | ntdll!NtCreateFile      |
///   | DR1 | ntdll!NtOpenFile        |
///   | DR2 | ntdll!NtDeleteFile      |
///   | DR3 | ntdll!NtSetInformationFile (rename class) |
///
/// For every thread in every process in the tree, those four DRs are
/// armed. When a child thread executes one of those functions, the
/// CPU raises `EXCEPTION_SINGLE_STEP`; our `WaitForDebugEvent` loop
/// catches it, reads the syscall arguments from the child's registers
/// (`RCX`, `RDX`, `R8`, `R9`), walks the `OBJECT_ATTRIBUTES` →
/// `UNICODE_STRING` → buffer via `ReadProcessMemory` to recover the
/// filename, emits an `FsEvent`, and steps the child past the
/// breakpoint.
///
/// This is **event-driven, like the Linux ptrace path**. There's no
/// sub-poll-interval gap: every `NtCreateFile` call fires. And it's
/// **fully unprivileged** — no admin, no DLL injection, no code
/// executing in the child's address space, nothing for AV heuristics
/// to flag.
///
/// Process-tree following
/// ----------------------
/// `DebugActiveProcess` attaches to a single process. When it spawns
/// children, Windows doesn't automatically follow them (the
/// `DEBUG_PROCESS` creation flag is a parent-side decision we don't
/// control). Instead we run a low-frequency process-enumeration poll
/// (Toolhelp32, 100 ms) to detect newly-spawned descendants and
/// attach to each via `DebugActiveProcess`. Once attached, debug
/// events arrive naturally — no polling for the file events
/// themselves.
///
/// Safety handshake
/// ----------------
/// `DebugActiveProcess` ties the debuggee to the debugger's
/// lifetime. If the debugger (us) dies uncleanly, Windows kills the
/// debuggee by default. We flip that with
/// `DebugSetProcessKillOnExit(FALSE)` before any real work so a
/// claude_tabs crash doesn't take the Claude CLI with it.
///
/// Known limitations (documented; not runtime bugs)
/// ------------------------------------------------
/// - **32-bit / WOW64 children.** A 64-bit debugger tracing a 32-bit
///   child needs `Wow64GetThreadContext` / `Wow64SetThreadContext`.
///   Claude Code CLI ships as 64-bit on Windows, so we don't take
///   this on yet; the hook point is marked in `configure_thread`.
/// - **ReadDirectoryChangesW-style external edits are NOT captured.**
///   The tracer only sees file ops initiated by the Claude tree.
///   That's by design — see the plan file.
/// - **Per-thread DR setup** happens on `CREATE_THREAD_DEBUG_EVENT`.
///   Any thread that was already running in the child before we
///   attached is handled because `DebugActiveProcess` synthesises
///   `CREATE_THREAD_DEBUG_EVENT` for each existing thread, so the
///   initial arm-all pass covers them uniformly.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{
    CloseHandle, DuplicateHandle, BOOL, DUPLICATE_SAME_ACCESS, EXCEPTION_SINGLE_STEP,
    FALSE, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
use windows_sys::Win32::System::Diagnostics::Debug::{
    ContinueDebugEvent, DebugActiveProcess, DebugActiveProcessStop,
    DebugSetProcessKillOnExit, ReadProcessMemory, WaitForDebugEventEx,
    CREATE_PROCESS_DEBUG_EVENT, CREATE_THREAD_DEBUG_EVENT, DEBUG_EVENT,
    EXCEPTION_DEBUG_EVENT, EXIT_PROCESS_DEBUG_EVENT, EXIT_THREAD_DEBUG_EVENT,
    LOAD_DLL_DEBUG_EVENT, OUTPUT_DEBUG_STRING_EVENT, RIP_EVENT,
    UNLOAD_DLL_DEBUG_EVENT,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows_sys::Win32::System::Memory::{VirtualQueryEx, MEMORY_BASIC_INFORMATION};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, OpenThread, THREAD_GET_CONTEXT,
    THREAD_SET_CONTEXT, THREAD_SUSPEND_RESUME,
};

// windows-sys 0.59 keeps `GetThreadContext` / `SetThreadContext`
// signatures bound to its own architecture-gated `CONTEXT` type,
// which doesn't always resolve the way we want. Declare our own
// bindings that accept our manually-defined [`Ctx`] struct below.
#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "GetThreadContext"]
    fn get_thread_context(h_thread: HANDLE, ctx: *mut Ctx) -> BOOL;
    #[link_name = "SetThreadContext"]
    fn set_thread_context(h_thread: HANDLE, ctx: *const Ctx) -> BOOL;
}

use super::event::{now_ms, FsEvent, FsOp, ProcessInfo};
use super::{is_noise, TracerBackend, FS_EVENT};

// ── CONTEXT_AMD64 — manual binding ──────────────────────────────────────
//
// windows-sys 0.59 gates the x86_64 `CONTEXT` struct behind a feature
// that doesn't always resolve the way we want across tool-chain
// configurations. The AMD64 layout is stable across Windows versions,
// so we define the fields we actually touch (debug registers,
// integer registers, flags, RIP) and reserve the rest as a byte
// blob. Total size is exactly 1232 bytes with 16-byte alignment, as
// required by `GetThreadContext`.
#[repr(C, align(16))]
#[derive(Copy, Clone)]
struct Ctx {
    // 0x000: P1..P6 Home — scratch storage for calling convention.
    _p_home: [u64; 6],
    // 0x030: ContextFlags — selects which fields Get/SetThreadContext read/write.
    context_flags: u32,
    _mx_csr: u32,
    // 0x038: 6 × WORD segment regs.
    _seg: [u16; 6],
    // 0x044: EFlags (trap-flag lives in bit 8).
    e_flags: u32,
    // 0x048..0x077: Dr0-Dr3, Dr6, Dr7.
    dr0: u64,
    dr1: u64,
    dr2: u64,
    dr3: u64,
    dr6: u64,
    dr7: u64,
    // 0x078..0x0F7: 16 general-purpose registers.
    _rax: u64,
    rcx: u64,
    rdx: u64,
    _rbx: u64,
    rsp: u64,
    _rbp: u64,
    _rsi: u64,
    _rdi: u64,
    r8: u64,
    r9: u64,
    _r10: u64,
    _r11: u64,
    _r12: u64,
    _r13: u64,
    _r14: u64,
    _r15: u64,
    // 0x0F8: Rip.
    _rip: u64,
    // 0x100..0x4D0: FloatSave (M128 × 26), VectorRegister[26], VectorControl,
    // DebugControl, LastBranch*, LastException*. We don't need any of it.
    _tail: [u8; 0x4D0 - 0x100],
}

impl Default for Ctx {
    fn default() -> Self {
        unsafe { std::mem::zeroed() }
    }
}

// Sanity: the layout is exact. If a future Windows or toolchain
// change breaks this, these const assertions will catch it at
// compile time rather than silently corrupt thread contexts.
const _: () = assert!(std::mem::size_of::<Ctx>() == 0x4D0);
const _: () = assert!(std::mem::align_of::<Ctx>() == 16);
const _: () = assert!(core::mem::offset_of!(Ctx, context_flags) == 0x030);
const _: () = assert!(core::mem::offset_of!(Ctx, e_flags) == 0x044);
const _: () = assert!(core::mem::offset_of!(Ctx, dr0) == 0x048);
const _: () = assert!(core::mem::offset_of!(Ctx, rcx) == 0x080);
const _: () = assert!(core::mem::offset_of!(Ctx, rsp) == 0x098);
const _: () = assert!(core::mem::offset_of!(Ctx, r8) == 0x0B8);

// ContextFlags bits we need. The high nibble 0x00100000 is the AMD64
// CONTEXT marker; the low bits select register groups.
const CONTEXT_AMD64: u32 = 0x0010_0000;
const CONTEXT_CONTROL: u32 = CONTEXT_AMD64 | 0x1;
const CONTEXT_INTEGER: u32 = CONTEXT_AMD64 | 0x2;
const CONTEXT_DBG: u32 = CONTEXT_AMD64 | 0x10;
const CONTEXT_FULL_NEEDED: u32 = CONTEXT_CONTROL | CONTEXT_INTEGER | CONTEXT_DBG;

// ── Constants ───────────────────────────────────────────────────────────

/// Process-enumeration poll interval — only used to discover newly
/// spawned descendants (file events themselves are event-driven via
/// hardware breakpoints).
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(100);

const DBG_CONTINUE: i32 = 0x0001_0002u32 as i32;
const DBG_EXCEPTION_NOT_HANDLED: i32 = 0x8001_0001u32 as i32;

/// OBJECT_ATTRIBUTES field offsets on x64.
const OA_ROOT_DIRECTORY_OFFSET: usize = 8;
const OA_OBJECT_NAME_OFFSET: usize = 16;

// ── TracerBackend impl ──────────────────────────────────────────────────

pub struct WindowsTracer {
    shutdown: Arc<AtomicBool>,
}

impl TracerBackend for WindowsTracer {
    fn detach(&self) {
        self.shutdown.store(true, Ordering::Release);
    }
}

pub fn attach(
    app: AppHandle,
    tab_id: String,
    root_pid: u32,
    _working_dir: Option<String>,
) -> Result<WindowsTracer, String> {
    let nt = NtFunctionTable::load()?;
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();

    let sink: Sink = Arc::new(move |ev: &FsEvent| {
        let _ = app.emit(FS_EVENT, ev);
    });

    std::thread::Builder::new()
        .name(format!("tracer-{}", tab_id))
        .spawn(move || {
            if let Err(e) = run(tab_id, root_pid, shutdown_clone, sink, nt) {
                log::warn!("tracer[windows]: run loop exited: {}", e);
            }
        })
        .map_err(|e| format!("tracer: failed to spawn thread: {}", e))?;

    Ok(WindowsTracer { shutdown })
}

// ── NtFunction address resolution ───────────────────────────────────────

/// Absolute addresses of the four Nt* functions we arm breakpoints on.
/// Resolved from our own process's ntdll.dll at startup; Windows maps
/// ntdll at the same base across every process in a boot session, so
/// the addresses are valid in the child too.
#[derive(Clone, Copy)]
struct NtFunctionTable {
    create_file: u64,
    open_file: u64,
    delete_file: u64,
    set_information_file: u64,
}

impl NtFunctionTable {
    fn load() -> Result<Self, String> {
        unsafe {
            let ntdll_name: Vec<u16> = "ntdll.dll\0".encode_utf16().collect();
            let ntdll = GetModuleHandleW(ntdll_name.as_ptr());
            if ntdll.is_null() {
                return Err("GetModuleHandleW(ntdll.dll) returned null".into());
            }
            let resolve = |name: &[u8]| -> Result<u64, String> {
                match GetProcAddress(ntdll, name.as_ptr()) {
                    Some(addr) => Ok(addr as u64),
                    None => Err(format!(
                        "GetProcAddress({}) returned null",
                        String::from_utf8_lossy(&name[..name.len() - 1])
                    )),
                }
            };
            Ok(NtFunctionTable {
                create_file: resolve(b"NtCreateFile\0")?,
                open_file: resolve(b"NtOpenFile\0")?,
                delete_file: resolve(b"NtDeleteFile\0")?,
                set_information_file: resolve(b"NtSetInformationFile\0")?,
            })
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NtCall {
    CreateFile,
    OpenFile,
    DeleteFile,
    SetInformationFile,
}

// ── Main loop ───────────────────────────────────────────────────────────

type Sink = Arc<dyn Fn(&FsEvent) + Send + Sync + 'static>;

struct TracerState {
    tab_id: String,
    root_pid: u32,
    nt: NtFunctionTable,
    /// All pids currently being debugged by us. Used so the
    /// process-enumeration poll can skip already-attached descendants.
    attached: HashMap<u32, AttachedProcess>,
    /// Per-pid process metadata (exe, argv-best-effort, ppid) used to
    /// populate the `processChain` on emitted FsEvents.
    nodes: HashMap<u32, ProcessNode>,
    sink: Sink,
}

struct AttachedProcess {
    process_handle: HANDLE,
    /// tid -> currently configured breakpoints.
    threads: HashMap<u32, ThreadBpState>,
}

/// Track per-thread state. When a DR-breakpoint fires we need to
/// single-step past the instruction at the breakpoint, re-arm, then
/// resume. `stepping_over` remembers which DR we temporarily disabled
/// so we can re-enable it on the subsequent single-step stop.
#[derive(Default)]
struct ThreadBpState {
    stepping_over: Option<u8>, // 0..=3 = DR index we disarmed to single-step
}

// SAFETY: HANDLE values we own (process/thread handles) are Send —
// Windows makes them per-process identifiers, not thread-bound. We
// always CloseHandle from the tracer thread that created them.
unsafe impl Send for AttachedProcess {}

fn run(
    tab_id: String,
    root_pid: u32,
    shutdown: Arc<AtomicBool>,
    sink: Sink,
    nt: NtFunctionTable,
) -> Result<(), String> {
    let mut state = TracerState {
        tab_id,
        root_pid,
        nt,
        attached: HashMap::new(),
        nodes: HashMap::new(),
        sink,
    };

    // Prevent Windows from killing the debuggee if we crash.
    unsafe {
        DebugSetProcessKillOnExit(FALSE as BOOL);
    }

    attach_process(&mut state, root_pid)?;

    let mut last_enum = std::time::Instant::now();

    loop {
        if shutdown.load(Ordering::Acquire) {
            break;
        }

        // Drain any pending debug events for up to 50 ms, then sweep
        // for new descendants. The 50 ms timeout lets us react to
        // shutdown promptly without a dedicated wakeup.
        let mut ev: DEBUG_EVENT = unsafe { std::mem::zeroed() };
        let got = unsafe { WaitForDebugEventEx(&mut ev, 50) };
        if got != 0 {
            let status = handle_debug_event(&mut state, &ev);
            unsafe {
                ContinueDebugEvent(ev.dwProcessId, ev.dwThreadId, status);
            }
        }

        if last_enum.elapsed() >= PROCESS_POLL_INTERVAL {
            last_enum = std::time::Instant::now();
            if let Err(e) = sweep_descendants(&mut state) {
                log::debug!("tracer[windows]: sweep failed: {}", e);
            }
        }
    }

    // Clean detach from every attached process.
    let pids: Vec<u32> = state.attached.keys().copied().collect();
    for pid in pids {
        unsafe {
            DebugActiveProcessStop(pid);
        }
        if let Some(mut ap) = state.attached.remove(&pid) {
            for (_tid, _) in ap.threads.drain() {
                // Per-thread handles are closed in handle_exit_thread.
            }
            unsafe {
                CloseHandle(ap.process_handle);
            }
        }
    }
    Ok(())
}

// ── Attach / detach ─────────────────────────────────────────────────────

fn attach_process(state: &mut TracerState, pid: u32) -> Result<(), String> {
    if state.attached.contains_key(&pid) {
        return Ok(());
    }
    let ok = unsafe { DebugActiveProcess(pid) };
    if ok == 0 {
        return Err(format!(
            "DebugActiveProcess(pid={}) failed: {}",
            pid,
            std::io::Error::last_os_error()
        ));
    }
    // process_handle is filled in when CREATE_PROCESS_DEBUG_EVENT for this
    // pid arrives (Windows synthesizes it right after DebugActiveProcess).
    // Until then `process_handle` stays null and any event that requires it
    // — e.g. build_event's ReadProcessMemory calls — short-circuits. In
    // practice the window is well under a millisecond; events arriving in
    // that gap are silently dropped rather than read with an invalid handle.
    state.attached.insert(
        pid,
        AttachedProcess {
            process_handle: std::ptr::null_mut(),
            threads: HashMap::new(),
        },
    );
    Ok(())
}

// ── Debug-event dispatch ────────────────────────────────────────────────

fn handle_debug_event(state: &mut TracerState, ev: &DEBUG_EVENT) -> i32 {
    match ev.dwDebugEventCode {
        CREATE_PROCESS_DEBUG_EVENT => {
            let info = unsafe { ev.u.CreateProcessInfo };
            if let Some(ap) = state.attached.get_mut(&ev.dwProcessId) {
                ap.process_handle = info.hProcess;
            }
            // The implicit initial thread that comes with
            // CREATE_PROCESS_DEBUG_EVENT needs breakpoints armed.
            configure_thread(state, ev.dwProcessId, ev.dwThreadId, info.hThread);
            // Record a process node if we haven't yet.
            record_process_node(state, ev.dwProcessId);
            // Close the image file handle we don't need; the process
            // handle is owned by AttachedProcess.
            if !info.hFile.is_null() {
                unsafe {
                    CloseHandle(info.hFile);
                }
            }
            DBG_CONTINUE
        }
        CREATE_THREAD_DEBUG_EVENT => {
            let info = unsafe { ev.u.CreateThread };
            configure_thread(state, ev.dwProcessId, ev.dwThreadId, info.hThread);
            DBG_CONTINUE
        }
        EXIT_THREAD_DEBUG_EVENT => {
            if let Some(ap) = state.attached.get_mut(&ev.dwProcessId) {
                ap.threads.remove(&ev.dwThreadId);
            }
            DBG_CONTINUE
        }
        EXIT_PROCESS_DEBUG_EVENT => {
            state.nodes.remove(&ev.dwProcessId);
            if let Some(ap) = state.attached.remove(&ev.dwProcessId) {
                if !ap.process_handle.is_null() {
                    unsafe {
                        CloseHandle(ap.process_handle);
                    }
                }
            }
            DBG_CONTINUE
        }
        LOAD_DLL_DEBUG_EVENT => {
            let info = unsafe { ev.u.LoadDll };
            if !info.hFile.is_null() {
                unsafe {
                    CloseHandle(info.hFile);
                }
            }
            DBG_CONTINUE
        }
        UNLOAD_DLL_DEBUG_EVENT | OUTPUT_DEBUG_STRING_EVENT | RIP_EVENT => DBG_CONTINUE,
        EXCEPTION_DEBUG_EVENT => handle_exception(state, ev),
        _ => DBG_CONTINUE,
    }
}

// ── Breakpoint arming ───────────────────────────────────────────────────

/// Arm DR0..DR3 on the given thread to break on the four Nt* entry
/// points. DR7 layout:
/// - bits 0,2,4,6  : L0/L1/L2/L3 (local enable)
/// - bits 16-17    : RW0 (00 = execute)
/// - bits 18-19    : LEN0 (00 = 1 byte — correct for execute)
/// - bits 20-23    : RW1/LEN1
/// - bits 24-27    : RW2/LEN2
/// - bits 28-31    : RW3/LEN3
///
/// For execute breakpoints, LEN must be 00 (1 byte) and RW must be 00.
/// That means the entire upper half of DR7 is zero — we just set the
/// four local-enable bits.
fn configure_thread(state: &mut TracerState, pid: u32, tid: u32, hthread: HANDLE) {
    // Store the handle for later use. `hthread` from debug events is
    // owned by Windows (don't close it); for state-tracked threads we
    // open our own handle so it stays valid after the debug event is
    // consumed.
    let _ = hthread; // the debug-event thread handle is owned by us
                     // during this event only — open a fresh one.

    let owned = unsafe {
        OpenThread(
            THREAD_GET_CONTEXT | THREAD_SET_CONTEXT | THREAD_SUSPEND_RESUME,
            FALSE as BOOL,
            tid,
        )
    };
    if owned.is_null() {
        log::debug!(
            "tracer[windows]: OpenThread(tid={}) failed: {}",
            tid,
            std::io::Error::last_os_error()
        );
        return;
    }

    set_all_breakpoints(owned, &state.nt);

    // Close the thread handle — debug events deliver a fresh one
    // each time. We don't need to keep it; it's the thread identity
    // we care about, kept in `threads` by tid.
    unsafe {
        CloseHandle(owned);
    }

    if let Some(ap) = state.attached.get_mut(&pid) {
        ap.threads.insert(tid, ThreadBpState::default());
    }
}

fn set_all_breakpoints(hthread: HANDLE, nt: &NtFunctionTable) {
    let mut ctx: Ctx = Ctx::default();
    ctx.context_flags = CONTEXT_DBG;
    let ok = unsafe { get_thread_context(hthread, &mut ctx) };
    if ok == 0 {
        log::debug!(
            "tracer[windows]: GetThreadContext failed: {}",
            std::io::Error::last_os_error()
        );
        return;
    }
    ctx.dr0 = nt.create_file;
    ctx.dr1 = nt.open_file;
    ctx.dr2 = nt.delete_file;
    ctx.dr3 = nt.set_information_file;
    // Set local-enable for all four slots; RW/LEN default to zero
    // (execute, 1 byte), which is what we want.
    ctx.dr7 = (1u64 << 0) | (1u64 << 2) | (1u64 << 4) | (1u64 << 6);
    ctx.context_flags = CONTEXT_DBG;
    let _ = unsafe { set_thread_context(hthread, &ctx) };
}

// ── Exception handling (the actual file-event capture) ──────────────────

fn handle_exception(state: &mut TracerState, ev: &DEBUG_EVENT) -> i32 {
    let excp = unsafe { &ev.u.Exception };
    let rec = &excp.ExceptionRecord;
    // First-chance only — second-chance means the child is about to
    // crash anyway, let Windows deliver it. Hardware-BP exceptions
    // are always first-chance under a debugger.
    if excp.dwFirstChance == 0 {
        return DBG_EXCEPTION_NOT_HANDLED;
    }

    if rec.ExceptionCode as i64 == EXCEPTION_SINGLE_STEP as i64 {
        return handle_hw_breakpoint(state, ev.dwProcessId, ev.dwThreadId);
    }

    // All other exceptions (access violations, etc.) are the child's
    // problem — pass through untouched.
    DBG_EXCEPTION_NOT_HANDLED
}

fn handle_hw_breakpoint(state: &mut TracerState, pid: u32, tid: u32) -> i32 {
    let hthread = unsafe {
        OpenThread(
            THREAD_GET_CONTEXT | THREAD_SET_CONTEXT,
            FALSE as BOOL,
            tid,
        )
    };
    if hthread.is_null() {
        return DBG_CONTINUE;
    }
    let mut ctx: Ctx = Ctx::default();
    ctx.context_flags = CONTEXT_FULL_NEEDED;
    let ok = unsafe { get_thread_context(hthread, &mut ctx) };
    if ok == 0 {
        unsafe { CloseHandle(hthread) };
        return DBG_CONTINUE;
    }

    // Were we single-stepping past a previously-hit breakpoint? DR6
    // bit 14 (BS) is set on a real single-step. In that case, re-arm
    // the breakpoint we disabled and clear the trap flag.
    let is_single_step_resume = match state
        .attached
        .get_mut(&pid)
        .and_then(|ap| ap.threads.get_mut(&tid))
    {
        Some(t) if t.stepping_over.is_some() => {
            let dr_idx = t.stepping_over.take().unwrap();
            // Re-enable the DR local bit (bits 0/2/4/6 for DR0..DR3).
            ctx.dr7 |= 1u64 << (dr_idx * 2);
            // Clear the trap flag (bit 8 of RFLAGS).
            ctx.e_flags &= !0x100;
            // Clear DR6 (Windows doesn't auto-clear).
            ctx.dr6 = 0;
            ctx.context_flags = CONTEXT_DBG | CONTEXT_CONTROL;
            let _ = unsafe { set_thread_context(hthread, &ctx) };
            unsafe { CloseHandle(hthread) };
            true
        }
        _ => false,
    };
    if is_single_step_resume {
        return DBG_CONTINUE;
    }

    // Otherwise, this is a fresh DR hit. Figure out which DR fired
    // from DR6 bits 0..3 (B0..B3).
    let b0 = (ctx.dr6 & 0b0001) != 0;
    let b1 = (ctx.dr6 & 0b0010) != 0;
    let b2 = (ctx.dr6 & 0b0100) != 0;
    let b3 = (ctx.dr6 & 0b1000) != 0;
    let (call, dr_idx) = if b0 {
        (Some(NtCall::CreateFile), 0u8)
    } else if b1 {
        (Some(NtCall::OpenFile), 1u8)
    } else if b2 {
        (Some(NtCall::DeleteFile), 2u8)
    } else if b3 {
        (Some(NtCall::SetInformationFile), 3u8)
    } else {
        (None, 0u8)
    };

    if let Some(call) = call {
        // Extract the event.
        if let Some(ev) = build_event(state, pid, tid, call, &ctx) {
            (state.sink)(&ev);
        }

        // Step over the instruction at the breakpoint so the child's
        // call actually runs. Disable the DR local-enable, set the
        // trap flag, and remember we're stepping.
        ctx.dr7 &= !(1u64 << (dr_idx * 2));
        ctx.e_flags |= 0x100;
        // Clear DR6 so the next hit reports fresh bits.
        ctx.dr6 = 0;
        ctx.context_flags = CONTEXT_DBG | CONTEXT_CONTROL;
        let _ = unsafe { set_thread_context(hthread, &ctx) };

        if let Some(ap) = state.attached.get_mut(&pid) {
            if let Some(t) = ap.threads.get_mut(&tid) {
                t.stepping_over = Some(dr_idx);
            }
        }
    } else {
        // Spurious DR hit (should not happen) — just clear and go.
        ctx.dr6 = 0;
        ctx.context_flags = CONTEXT_DBG;
        let _ = unsafe { set_thread_context(hthread, &ctx) };
    }

    unsafe { CloseHandle(hthread) };
    DBG_CONTINUE
}

// ── Event construction ──────────────────────────────────────────────────

fn build_event(
    state: &mut TracerState,
    pid: u32,
    _tid: u32,
    call: NtCall,
    ctx: &Ctx,
) -> Option<FsEvent> {
    let hprocess = state.attached.get(&pid)?.process_handle;
    if hprocess.is_null() {
        return None;
    }

    // Nt* calling convention on x64 matches the Win64 ABI:
    // RCX, RDX, R8, R9 then stack. For the four functions we hook:
    //
    //   NtCreateFile(
    //     OUT PHANDLE FileHandle,              // RCX
    //     IN ACCESS_MASK DesiredAccess,        // RDX
    //     IN POBJECT_ATTRIBUTES ObjectAttrs,   // R8
    //     ...);
    //   NtOpenFile: same first 3 args.
    //   NtDeleteFile(IN POBJECT_ATTRIBUTES);   // RCX
    //   NtSetInformationFile(
    //     IN HANDLE FileHandle,                // RCX
    //     OUT PIO_STATUS_BLOCK IoStatusBlock,  // RDX
    //     IN PVOID FileInformation,            // R8
    //     IN ULONG Length,                     // R9d
    //     IN FILE_INFORMATION_CLASS FileInformationClass); // stack — [RSP+0x28]
    match call {
        NtCall::CreateFile | NtCall::OpenFile => {
            let path = read_object_name(hprocess, ctx.r8)?;
            if is_noise(&path) {
                return None;
            }
            // Win32 GENERIC_WRITE = 0x40000000, FILE_WRITE_DATA = 0x2,
            // FILE_APPEND_DATA = 0x4, FILE_WRITE_EA = 0x10,
            // FILE_WRITE_ATTRIBUTES = 0x100.
            let write_mask: u32 = 0x4000_0000 | 0x0002 | 0x0004 | 0x0010 | 0x0100;
            let op = if (ctx.rdx as u32) & write_mask != 0 {
                FsOp::Write
            } else {
                FsOp::Read
            };
            Some(emit_event(state, pid, op, path))
        }
        NtCall::DeleteFile => {
            let path = read_object_name(hprocess, ctx.rcx)?;
            if is_noise(&path) {
                return None;
            }
            Some(emit_event(state, pid, FsOp::Delete, path))
        }
        NtCall::SetInformationFile => decode_set_information_file(state, pid, hprocess, ctx),
    }
}

fn emit_event(
    state: &TracerState,
    pid: u32,
    op: FsOp,
    path: String,
) -> FsEvent {
    let ppid = state.nodes.get(&pid).map(|n| n.ppid).unwrap_or(0);
    let process_chain = build_chain(pid, state.root_pid, &state.nodes);
    FsEvent {
        tab_id: state.tab_id.clone(),
        op,
        path,
        pid,
        ppid,
        process_chain,
        timestamp_ms: now_ms(),
    }
}

/// Decode `NtSetInformationFile` for the two `FileInformationClass`
/// values that carry filesystem semantics:
///
/// - `FileRenameInformation` (10) / `FileRenameInformationEx` (65)
///   → `FsOp::Rename { from }` with `path = to`.
/// - `FileDispositionInformation` (13) /
///   `FileDispositionInformationEx` (64) with `DeleteFile = TRUE`
///   → `FsOp::Delete`.
///
/// Other classes (FILE_POSITION_INFORMATION, FILE_BASIC_INFORMATION,
/// etc.) are not filesystem semantics we surface; returning `None`
/// suppresses the event without disturbing the child's syscall.
fn decode_set_information_file(
    state: &mut TracerState,
    pid: u32,
    hprocess: HANDLE,
    ctx: &Ctx,
) -> Option<FsEvent> {
    const FILE_RENAME_INFORMATION: u32 = 10;
    const FILE_DISPOSITION_INFORMATION: u32 = 13;
    const FILE_RENAME_INFORMATION_EX: u32 = 65;
    const FILE_DISPOSITION_INFORMATION_EX: u32 = 64;

    // Read the 5th argument off the child's stack. Win64 ABI lays out
    // RSP at callee entry as:
    //   [RSP + 0x00] = return address
    //   [RSP + 0x08..0x28] = shadow space for RCX/RDX/R8/R9
    //   [RSP + 0x28] = 5th arg (FileInformationClass, int → 4 bytes,
    //                  occupies an 8-byte stack slot).
    let mut class_bytes = [0u8; 4];
    read_mem(hprocess, ctx.rsp + 0x28, &mut class_bytes)?;
    let class = u32::from_le_bytes(class_bytes);

    match class {
        FILE_RENAME_INFORMATION | FILE_RENAME_INFORMATION_EX => {
            // FILE_RENAME_INFORMATION layout on x64:
            //   0x00: BOOLEAN ReplaceIfExists   (1 byte, + 7 pad)
            //   0x08: HANDLE  RootDirectory     (8 bytes)
            //   0x10: ULONG   FileNameLength    (4 bytes, bytes not chars)
            //   0x14: WCHAR   FileName[]        (variable, FileNameLength bytes)
            //
            // The _EX variant has the same layout modulo a renamed
            // flags field at offset 0 (kept compatible up through
            // FileName), so we read the same way.
            let mut hdr = [0u8; 20];
            read_mem(hprocess, ctx.r8, &mut hdr)?;
            let name_len = u32::from_le_bytes(hdr[16..20].try_into().ok()?) as usize;
            if name_len == 0 || name_len > 32_768 {
                return None;
            }
            let mut name_bytes = vec![0u8; name_len];
            read_mem(hprocess, ctx.r8 + 20, &mut name_bytes)?;
            let u16s: Vec<u16> = name_bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let to_raw = String::from_utf16_lossy(&u16s);
            // The new name may be relative to a RootDirectory. For a
            // rename without RootDirectory (the common case — shells
            // issue absolute paths), the name is either fully qualified
            // (`\??\C:\…`) or relative to the volume. Strip the
            // DOS-device prefix when present.
            let to = if let Some(rest) = to_raw.strip_prefix(r"\??\") {
                rest.to_string()
            } else {
                to_raw
            };

            // The "from" path is what the `FileHandle` in RCX currently
            // refers to. We duplicate the child's handle into our
            // process so we can call GetFinalPathNameByHandleW on it.
            let from = resolve_remote_handle_path(hprocess, ctx.rcx as HANDLE)
                .unwrap_or_default();

            if is_noise(&to) && is_noise(&from) {
                return None;
            }

            Some(emit_event(state, pid, FsOp::Rename { from }, to))
        }
        FILE_DISPOSITION_INFORMATION | FILE_DISPOSITION_INFORMATION_EX => {
            // FILE_DISPOSITION_INFORMATION: { BOOLEAN DeleteFile; }
            // FILE_DISPOSITION_INFORMATION_EX: { ULONG Flags; }
            //   Flags bit 0 (FILE_DISPOSITION_DELETE) == delete.
            let mut flag = [0u8; 4];
            read_mem(hprocess, ctx.r8, &mut flag)?;
            let will_delete = if class == FILE_DISPOSITION_INFORMATION_EX {
                (u32::from_le_bytes(flag) & 0x1) != 0
            } else {
                flag[0] != 0
            };
            if !will_delete {
                return None;
            }
            let path = resolve_remote_handle_path(hprocess, ctx.rcx as HANDLE)?;
            if is_noise(&path) {
                return None;
            }
            Some(emit_event(state, pid, FsOp::Delete, path))
        }
        _ => None,
    }
}

/// Duplicate a child's file handle into our process and resolve it via
/// `GetFinalPathNameByHandleW`. `\\?\` prefix is stripped. Returns
/// `None` for non-file handles (pipes, sockets, mutexes, etc.) or
/// when duplication fails.
fn resolve_remote_handle_path(hprocess: HANDLE, remote_handle: HANDLE) -> Option<String> {
    if remote_handle.is_null() {
        return None;
    }
    let mut dup: HANDLE = std::ptr::null_mut();
    let ok = unsafe {
        DuplicateHandle(
            hprocess,
            remote_handle,
            GetCurrentProcess(),
            &mut dup,
            0,
            FALSE as BOOL,
            DUPLICATE_SAME_ACCESS,
        )
    };
    if ok == 0 || dup.is_null() {
        return None;
    }
    let mut buf = vec![0u16; 1024];
    let len = unsafe {
        GetFinalPathNameByHandleW(dup, buf.as_mut_ptr(), buf.len() as u32, 0)
    };
    unsafe { CloseHandle(dup) };
    if len == 0 {
        return None;
    }
    let n = if (len as usize) > buf.len() {
        // Retry with larger buffer — len reports required size incl. null.
        buf.resize(len as usize + 1, 0);
        let mut dup2: HANDLE = std::ptr::null_mut();
        let ok2 = unsafe {
            DuplicateHandle(
                hprocess,
                remote_handle,
                GetCurrentProcess(),
                &mut dup2,
                0,
                FALSE as BOOL,
                DUPLICATE_SAME_ACCESS,
            )
        };
        if ok2 == 0 || dup2.is_null() {
            return None;
        }
        let n2 = unsafe {
            GetFinalPathNameByHandleW(dup2, buf.as_mut_ptr(), buf.len() as u32, 0)
        };
        unsafe { CloseHandle(dup2) };
        if n2 == 0 || (n2 as usize) > buf.len() {
            return None;
        }
        n2 as usize
    } else {
        len as usize
    };
    let raw = String::from_utf16_lossy(&buf[..n]);
    // Strip the `\\?\` / `\\?\UNC\` prefix so activity log shows Win32 paths.
    let cleaned = if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        raw
    };
    Some(cleaned)
}

/// Walk `POBJECT_ATTRIBUTES` → `UNICODE_STRING` → `Buffer` across
/// process memory and decode as UTF-16.
fn read_object_name(hprocess: HANDLE, oa_ptr: u64) -> Option<String> {
    if oa_ptr == 0 {
        return None;
    }
    // OBJECT_ATTRIBUTES is 48 bytes on x64; we only need offsets 8
    // and 16.
    let mut oa_buf = [0u8; 48];
    read_mem(hprocess, oa_ptr, &mut oa_buf)?;
    let _root_directory = u64::from_le_bytes(
        oa_buf[OA_ROOT_DIRECTORY_OFFSET..OA_ROOT_DIRECTORY_OFFSET + 8]
            .try_into()
            .ok()?,
    );
    let object_name_ptr = u64::from_le_bytes(
        oa_buf[OA_OBJECT_NAME_OFFSET..OA_OBJECT_NAME_OFFSET + 8]
            .try_into()
            .ok()?,
    );
    if object_name_ptr == 0 {
        return None;
    }

    // UNICODE_STRING layout: USHORT Length; USHORT MaximumLength; PWSTR Buffer
    // Total 16 bytes on x64 (8 bytes padding before the 8-byte Buffer pointer).
    let mut us_buf = [0u8; 16];
    read_mem(hprocess, object_name_ptr, &mut us_buf)?;
    let length = u16::from_le_bytes(us_buf[0..2].try_into().ok()?) as usize;
    let buffer_ptr = u64::from_le_bytes(us_buf[8..16].try_into().ok()?);
    if length == 0 || buffer_ptr == 0 || length > 32_768 {
        return None;
    }

    let mut bytes = vec![0u8; length];
    read_mem(hprocess, buffer_ptr, &mut bytes)?;
    let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let raw = String::from_utf16_lossy(&u16s);
    // NT paths look like `\??\C:\Users\…` or `\Device\Harddisk…`.
    // Strip the DOS-device prefix so the activity log shows clean
    // Win32 paths. Leave `\Device\` paths as-is (caller will filter
    // via is_noise).
    let stripped = if let Some(rest) = raw.strip_prefix(r"\??\") {
        rest.to_string()
    } else {
        raw
    };
    Some(stripped)
}

fn read_mem(hprocess: HANDLE, addr: u64, dst: &mut [u8]) -> Option<()> {
    // Cheap guard: use VirtualQueryEx to confirm the region is
    // committed before attempting ReadProcessMemory. Prevents noisy
    // errors when a pointer is bogus (child passed a null or garbage
    // OBJECT_ATTRIBUTES).
    let mut mbi: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
    let mbi_size = std::mem::size_of::<MEMORY_BASIC_INFORMATION>();
    let q = unsafe {
        VirtualQueryEx(
            hprocess,
            addr as *const core::ffi::c_void,
            &mut mbi,
            mbi_size,
        )
    };
    if q == 0 {
        return None;
    }
    // MEM_COMMIT = 0x1000
    if mbi.State != 0x1000 {
        return None;
    }

    // ReadProcessMemory is imported at the top of the module.
    let mut read: usize = 0;
    let ok = unsafe {
        ReadProcessMemory(
            hprocess,
            addr as *const core::ffi::c_void,
            dst.as_mut_ptr() as *mut core::ffi::c_void,
            dst.len(),
            &mut read,
        )
    };
    if ok == 0 || read != dst.len() {
        return None;
    }
    Some(())
}

// ── Process tree bookkeeping ────────────────────────────────────────────

use super::chain::{build_chain, ProcessNode};

fn record_process_node(state: &mut TracerState, pid: u32) {
    if state.nodes.contains_key(&pid) {
        return;
    }
    // Build from Toolhelp32 — same snapshot used in sweep_descendants.
    if let Ok(list) = snapshot_all_processes() {
        if let Some((p, ppid, exe)) = list.iter().find(|(p, _, _)| *p == pid) {
            state.nodes.insert(
                *p,
                ProcessNode {
                    pid: *p,
                    ppid: *ppid,
                    exe: exe.clone(),
                    argv: Vec::new(),
                },
            );
        }
    }
}

fn snapshot_all_processes() -> Result<Vec<(u32, u32, String)>, String> {
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snap == INVALID_HANDLE_VALUE {
        return Err("CreateToolhelp32Snapshot failed".into());
    }
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut all = Vec::new();
    unsafe {
        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                all.push((
                    entry.th32ProcessID,
                    entry.th32ParentProcessID,
                    wide_to_string(&entry.szExeFile),
                ));
                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    Ok(all)
}

fn wide_to_string(wide: &[u16]) -> String {
    let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..len])
}

/// Discover newly-spawned descendants of root_pid and attach to them.
/// Runs at `PROCESS_POLL_INTERVAL`; debug events for already-attached
/// processes flow through the main loop event-driven.
fn sweep_descendants(state: &mut TracerState) -> Result<(), String> {
    let all = snapshot_all_processes()?;

    // BFS from root_pid.
    let mut tree: Vec<(u32, u32, String)> = Vec::new();
    let mut q = std::collections::VecDeque::new();
    q.push_back(state.root_pid);
    let mut visited = std::collections::HashSet::new();
    while let Some(pid) = q.pop_front() {
        if !visited.insert(pid) {
            continue;
        }
        if let Some(entry) = all.iter().find(|(p, _, _)| *p == pid) {
            tree.push(entry.clone());
            for (cpid, cppid, _) in &all {
                if *cppid == pid {
                    q.push_back(*cpid);
                }
            }
        }
    }

    let our_pid = unsafe { GetCurrentProcessId() };
    for (pid, ppid, exe) in &tree {
        state
            .nodes
            .entry(*pid)
            .or_insert_with(|| ProcessNode {
                pid: *pid,
                ppid: *ppid,
                exe: exe.clone(),
                argv: Vec::new(),
            });
        if !state.attached.contains_key(pid) && *pid != our_pid {
            if let Err(e) = attach_process(state, *pid) {
                log::debug!("tracer[windows]: attach_process({}) failed: {}", pid, e);
            }
        }
    }

    Ok(())
}

// ── `read_mem` helper ───────────────────────────────────────────────────

// (see helper body above)
