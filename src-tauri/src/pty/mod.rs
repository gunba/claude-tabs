/// Direct PTY module — replaces tauri-plugin-pty with plain Tauri commands.
///
/// Provides spawn/read/write/resize/kill/exitstatus/destroy commands
/// using direct OS APIs (ConPTY on Windows, openpty on Unix).
use std::collections::BTreeMap;
use std::fmt;
use std::io::Write;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};

use serde::Serialize;
use tauri::async_runtime::{Mutex, RwLock};

use tauri::ipc::Response;
use tokio::sync::watch;

use crate::observability::record_backend_event;

#[cfg(windows)]
pub mod conpty;
#[cfg(unix)]
pub mod unix;
#[cfg(windows)]
use conpty as platform;
#[cfg(unix)]
use unix as platform;

const PTY_READ_BATCH_MAX_BYTES: usize = 256 * 1024;

type ReaderMessage = Result<Vec<u8>, String>;
type ExitState = Option<Result<u32, String>>;

trait PtyBackend: Send + Sync + 'static {
    fn resize(&self, cols: u16, rows: u16) -> Result<(), String>;
    fn kill(&self) -> Result<(), String>;
    fn wait(&self) -> Result<u32, String>;
}

#[cfg(windows)]
impl PtyBackend for conpty::ConPtyHandle {
    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.resize(cols, rows)
    }

    fn kill(&self) -> Result<(), String> {
        self.kill()
    }

    fn wait(&self) -> Result<u32, String> {
        self.wait()
    }
}

#[cfg(unix)]
impl PtyBackend for unix::UnixPty {
    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.resize(cols, rows)
    }

    fn kill(&self) -> Result<(), String> {
        self.kill()
    }

    fn wait(&self) -> Result<u32, String> {
        self.wait()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PtyError {
    SessionNotFound { pid: PtyHandler },
    Spawn { message: String },
    Write { message: String },
    Read { message: String },
    Resize { message: String },
    Kill { message: String },
    Wait { message: String },
    Eof,
    JoinFailed { message: String },
}

impl PtyError {
    fn session_not_found(pid: PtyHandler) -> Self {
        Self::SessionNotFound { pid }
    }

    fn spawn(message: impl ToString) -> Self {
        Self::Spawn {
            message: message.to_string(),
        }
    }

    fn write(message: impl ToString) -> Self {
        Self::Write {
            message: message.to_string(),
        }
    }

    fn read(message: impl ToString) -> Self {
        Self::Read {
            message: message.to_string(),
        }
    }

    fn resize(message: impl ToString) -> Self {
        Self::Resize {
            message: message.to_string(),
        }
    }

    fn kill(message: impl ToString) -> Self {
        Self::Kill {
            message: message.to_string(),
        }
    }

    fn wait(message: impl ToString) -> Self {
        Self::Wait {
            message: message.to_string(),
        }
    }

    fn join_failed(message: impl ToString) -> Self {
        Self::JoinFailed {
            message: message.to_string(),
        }
    }
}

impl fmt::Display for PtyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SessionNotFound { pid } => write!(f, "Unavailable pid {pid}"),
            Self::Spawn { message } => write!(f, "PTY spawn failed: {message}"),
            Self::Write { message } => write!(f, "PTY write failed: {message}"),
            Self::Read { message } => write!(f, "PTY read failed: {message}"),
            Self::Resize { message } => write!(f, "PTY resize failed: {message}"),
            Self::Kill { message } => write!(f, "PTY kill failed: {message}"),
            Self::Wait { message } => write!(f, "PTY wait failed: {message}"),
            Self::Eof => write!(f, "EOF"),
            Self::JoinFailed { message } => write!(f, "PTY blocking task failed: {message}"),
        }
    }
}

impl std::error::Error for PtyError {}

fn pty_spawn_env(env: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    // [PT-19] TERM/COLORTERM defaults injected before caller env so caller wins on conflict.
    // [PT-23] Advertise as xterm-ghostty so Claude Code's TUI uses sync output.
    let mut merged = BTreeMap::from([
        ("TERM".to_string(), "xterm-ghostty".to_string()),
        ("TERM_PROGRAM".to_string(), "ghostty".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
    ]);
    for (k, v) in env {
        merged.insert(k.clone(), v.clone());
    }
    merged
}

// ── State ────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct PtyState {
    session_id: AtomicU32,
    sessions: RwLock<BTreeMap<PtyHandler, Arc<Session>>>,
}

type PtyHandler = u32;

struct Session {
    session_id: Option<String>,
    backend: Arc<dyn PtyBackend>,
    writer: Mutex<Box<dyn Write + Send>>,
    output_rx: Mutex<tokio::sync::mpsc::Receiver<ReaderMessage>>,
    exit_tx: watch::Sender<ExitState>,
    shutdown_tx: watch::Sender<bool>,
    process_id: u32,
}

// ── Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pty_spawn(
    app: tauri::AppHandle,
    session_id: Option<String>,
    file: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    state: tauri::State<'_, PtyState>,
) -> Result<PtyHandler, PtyError> {
    let env_keys: Vec<String> = env.keys().cloned().collect();
    record_backend_event(
        &app,
        "LOG",
        "pty",
        session_id.as_deref(),
        "pty.spawn_requested",
        "PTY spawn requested",
        serde_json::json!({
            "file": &file,
            "args": &args,
            "cwd": &cwd,
            "cols": cols,
            "rows": rows,
            "envKeys": &env_keys,
        }),
    );

    let spawn_env = pty_spawn_env(&env);
    let result = platform::spawn(&file, &args, cols, rows, cwd.as_deref(), &spawn_env)
        .map_err(PtyError::spawn)?;

    let handler = state.session_id.fetch_add(1, Ordering::Relaxed);
    let backend: Arc<dyn PtyBackend> = Arc::new(result.backend);
    let (exit_tx, _) = watch::channel::<ExitState>(None);
    let wait_backend = backend.clone();
    let wait_tx = exit_tx.clone();
    tauri::async_runtime::spawn(async move {
        let wait_result = tauri::async_runtime::spawn_blocking(move || wait_backend.wait())
            .await
            .map_err(|e| format!("join error: {e}"))
            .and_then(|result| result);
        let _ = wait_tx.send(Some(wait_result));
    });
    let (shutdown_tx, _) = watch::channel(false);

    let session = Arc::new(Session {
        session_id: session_id.clone(),
        backend,
        writer: Mutex::new(Box::new(result.writer)),
        output_rx: Mutex::new(result.output_rx),
        exit_tx,
        shutdown_tx,
        process_id: result.process_id,
    });

    state.sessions.write().await.insert(handler, session);
    record_backend_event(
        &app,
        "LOG",
        "pty",
        session_id.as_deref(),
        "pty.spawned",
        "PTY spawned",
        serde_json::json!({
            "handler": handler,
            "childPid": result.process_id,
            "cols": cols,
            "rows": rows,
        }),
    );
    Ok(handler)
}

#[tauri::command]
pub async fn pty_write(
    pid: PtyHandler,
    data: String,
    state: tauri::State<'_, PtyState>,
) -> Result<(), PtyError> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or_else(|| PtyError::session_not_found(pid))?
        .clone();
    session
        .writer
        .lock()
        .await
        .write_all(data.as_bytes())
        .map_err(PtyError::write)?;
    Ok(())
}

/// [PT-16] Read output from a PTY session.
///
/// Pipeline: ConPTY/PTY pipe -> background reader thread -> channel ->
/// IPC response (raw binary).
///
/// Returns `tauri::ipc::Response` for zero-copy binary transfer —
/// bypasses JSON serialization (Vec<u8> would serialize as number[]).
#[tauri::command]
pub async fn pty_read(
    pid: PtyHandler,
    state: tauri::State<'_, PtyState>,
) -> Result<Response, PtyError> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or_else(|| PtyError::session_not_found(pid))?
        .clone();

    let mut shutdown_rx = session.shutdown_tx.subscribe();
    if *shutdown_rx.borrow() {
        return Err(PtyError::Eof);
    }
    let mut output_rx = session.output_rx.lock().await;

    // [PT-27] Drain queued chunks after the awaited recv to cut IPC round-trips during high-throughput output (try_recv until Empty/Disconnected; bound: PTY_READ_BATCH_MAX_BYTES=256KB).
    let first = tokio::select! {
        item = output_rx.recv() => item.ok_or(PtyError::Eof)?,
        _ = shutdown_rx.changed() => return Err(PtyError::Eof),
    };
    let mut data = first.map_err(PtyError::read)?;
    while data.len() < PTY_READ_BATCH_MAX_BYTES {
        match output_rx.try_recv() {
            Ok(Ok(mut next)) => data.append(&mut next),
            Ok(Err(err)) => return Err(PtyError::read(err)),
            Err(tokio::sync::mpsc::error::TryRecvError::Empty) => break,
            Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => break,
        }
    }
    Ok(Response::new(data))
}

#[tauri::command]
pub async fn pty_resize(
    pid: PtyHandler,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PtyState>,
) -> Result<(), PtyError> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or_else(|| PtyError::session_not_found(pid))?
        .clone();

    session
        .backend
        .resize(cols, rows)
        .map_err(PtyError::resize)?;

    Ok(())
}

#[tauri::command]
pub async fn pty_kill(
    app: tauri::AppHandle,
    pid: PtyHandler,
    state: tauri::State<'_, PtyState>,
) -> Result<(), PtyError> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or_else(|| PtyError::session_not_found(pid))?
        .clone();

    record_backend_event(
        &app,
        "LOG",
        "pty",
        session.session_id.as_deref(),
        "pty.kill_requested",
        "PTY kill requested",
        serde_json::json!({
            "handler": pid,
            "childPid": session.process_id,
        }),
    );

    let backend = session.backend.clone();
    tauri::async_runtime::spawn_blocking(move || backend.kill())
        .await
        .map_err(PtyError::join_failed)?
        .map_err(PtyError::kill)?;

    record_backend_event(
        &app,
        "LOG",
        "pty",
        session.session_id.as_deref(),
        "pty.killed",
        "PTY kill completed",
        serde_json::json!({
            "handler": pid,
            "childPid": session.process_id,
        }),
    );
    Ok(())
}

#[tauri::command]
pub async fn pty_exitstatus(
    pid: PtyHandler,
    state: tauri::State<'_, PtyState>,
) -> Result<u32, PtyError> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or_else(|| PtyError::session_not_found(pid))?
        .clone();

    let mut exit_rx = session.exit_tx.subscribe();
    loop {
        if let Some(result) = exit_rx.borrow().clone() {
            return result.map_err(PtyError::wait);
        }
        exit_rx
            .changed()
            .await
            .map_err(|_| PtyError::wait("exit watcher closed"))?;
    }
}

#[tauri::command]
pub async fn pty_destroy(
    pid: PtyHandler,
    state: tauri::State<'_, PtyState>,
) -> Result<(), PtyError> {
    if let Some(session) = state.sessions.write().await.remove(&pid) {
        let _ = session.shutdown_tx.send(true);
        let backend = session.backend.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || backend.kill()).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn pty_get_child_pid(
    pid: PtyHandler,
    state: tauri::State<'_, PtyState>,
) -> Result<Option<u32>, PtyError> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or_else(|| PtyError::session_not_found(pid))?
        .clone();
    Ok(Some(session.process_id))
}

/// [PT-18] Drain remaining output from the channel before destroying a session.
/// Prevents the background reader thread from blocking on a full channel
/// after the child process exits.
#[tauri::command]
pub async fn pty_drain_output(
    pid: PtyHandler,
    state: tauri::State<'_, PtyState>,
) -> Result<(), PtyError> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or_else(|| PtyError::session_not_found(pid))?
        .clone();

    let mut output_rx = session.output_rx.lock().await;
    while output_rx.try_recv().is_ok() {}
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pty_spawn_env_sets_term_defaults_and_allows_overrides() {
        let env = BTreeMap::from([
            ("TERM".to_string(), "xterm-256color".to_string()),
            ("CUSTOM".to_string(), "1".to_string()),
        ]);

        let merged = pty_spawn_env(&env);

        assert_eq!(
            merged.get("TERM").map(String::as_str),
            Some("xterm-256color")
        );
        assert_eq!(
            merged.get("TERM_PROGRAM").map(String::as_str),
            Some("ghostty")
        );
        assert_eq!(
            merged.get("COLORTERM").map(String::as_str),
            Some("truecolor")
        );
        assert_eq!(merged.get("CUSTOM").map(String::as_str), Some("1"));
    }

    #[test]
    fn pty_error_serializes_discriminated_kind() {
        let value = serde_json::to_value(PtyError::session_not_found(42)).unwrap();

        assert_eq!(value["kind"], "sessionNotFound");
        assert_eq!(value["pid"], 42);
    }
}
