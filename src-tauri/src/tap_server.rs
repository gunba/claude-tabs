use std::collections::HashMap;
use std::io::ErrorKind;
use std::io::{BufRead, BufReader};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter};

use crate::observability::record_backend_event;

const TAP_READER_BUFFER_CAPACITY: usize = 64 * 1024;
const TAP_EMIT_BATCH_MAX_LINES: usize = 128;
const TAP_EMIT_BATCH_MAX_BYTES: usize = 256 * 1024;

struct TapServerControl {
    stop: Arc<AtomicBool>,
    port: u16,
    client: Option<TcpStream>,
}

pub struct TapServerState {
    active: HashMap<String, TapServerControl>,
}

impl TapServerState {
    pub fn new() -> Self {
        Self {
            active: HashMap::new(),
        }
    }

    /// Set stop flag for all active servers (used on app exit).
    pub fn stop_all(&mut self) -> Vec<u16> {
        let mut ports = Vec::with_capacity(self.active.len());
        for control in self.active.values_mut() {
            control.stop.store(true, Ordering::Release);
            if let Some(client) = &control.client {
                client.shutdown(Shutdown::Both).ok();
            }
            ports.push(control.port);
        }
        ports
    }

    fn stop_session(&mut self, session_id: &str) -> Option<u16> {
        let control = self.active.get_mut(session_id)?;
        control.stop.store(true, Ordering::Release);
        if let Some(client) = &control.client {
            client.shutdown(Shutdown::Both).ok();
        }
        Some(control.port)
    }
}

pub(crate) fn wake_tap_listener(port: u16) {
    TcpStream::connect(("127.0.0.1", port)).ok();
}

fn should_stop(stop: &AtomicBool) -> bool {
    stop.load(Ordering::Acquire)
}

fn set_active_client(
    state: &Arc<Mutex<TapServerState>>,
    session_id: &str,
    client: Option<TcpStream>,
) {
    if let Ok(mut s) = state.lock() {
        if let Some(control) = s.active.get_mut(session_id) {
            control.client = client;
        }
    }
}

fn push_tap_line(batch: &mut Vec<String>, batch_bytes: &mut usize, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    *batch_bytes += trimmed.len();
    batch.push(trimmed.to_string());
}

fn emit_tap_batch(
    app: &AppHandle,
    event_name: &str,
    batch: &mut Vec<String>,
    batch_bytes: &mut usize,
) {
    if batch.is_empty() {
        return;
    }
    if batch.len() == 1 {
        app.emit(event_name, batch[0].clone()).ok();
    } else {
        app.emit(event_name, batch.join("\n")).ok();
    }
    batch.clear();
    *batch_bytes = 0;
}

fn log_tap_read_error(app: &AppHandle, session_id: &str, err: &std::io::Error) {
    let expected_close = matches!(
        err.kind(),
        ErrorKind::ConnectionReset
            | ErrorKind::BrokenPipe
            | ErrorKind::UnexpectedEof
            | ErrorKind::ConnectionAborted
    );
    record_backend_event(
        app,
        if expected_close { "LOG" } else { "WARN" },
        "tap-server",
        Some(session_id),
        if expected_close {
            "tap.server.client_disconnected"
        } else {
            "tap.server.read_error"
        },
        if expected_close {
            "Tap client disconnected"
        } else {
            "Tap client read error"
        },
        serde_json::json!({ "error": err.to_string() }),
    );
}

/// Start a per-session TCP listener. Returns the OS-assigned port.
/// The background thread accepts one connection at a time, reads JSONL lines,
/// and emits single lines or newline-delimited batches as a session-scoped Tauri event.
// [IN-33] Batched JSONL emit (max 128 lines / 256KB per Tauri event) + blocking accept woken via wake_tap_listener TcpStream::connect on stop.
#[tauri::command]
pub fn start_tap_server(
    app: AppHandle,
    session_id: String,
    tap_state: tauri::State<'_, Arc<Mutex<TapServerState>>>,
) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("TCP bind failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr failed: {e}"))?
        .port();

    let sid = session_id.clone();
    let state = tap_state.inner().clone();
    let stop = Arc::new(AtomicBool::new(false));

    // Mark as active
    if let Ok(mut s) = state.lock() {
        s.active.insert(
            sid.clone(),
            TapServerControl {
                stop: stop.clone(),
                port,
                client: None,
            },
        );
    }

    record_backend_event(
        &app,
        "LOG",
        "tap-server",
        Some(&sid),
        "tap.server.start",
        "Tap TCP server started",
        serde_json::json!({ "port": port }),
    );

    let event_name = format!("tap-entry-{sid}");
    let sid_for_thread = sid.clone();
    let app_for_thread = app.clone();
    let stop_for_thread = stop.clone();

    std::thread::spawn(move || {
        // Accept loop — one connection at a time, re-accept on disconnect
        loop {
            if should_stop(&stop_for_thread) {
                break;
            }

            match listener.accept() {
                Ok((stream, addr)) => {
                    if should_stop(&stop_for_thread) {
                        break;
                    }

                    record_backend_event(
                        &app_for_thread,
                        "LOG",
                        "tap-server",
                        Some(&sid_for_thread),
                        "tap.server.client_connected",
                        "Tap client connected",
                        serde_json::json!({ "remoteAddr": addr.to_string() }),
                    );
                    set_active_client(&state, &sid, stream.try_clone().ok());

                    let mut reader = BufReader::with_capacity(TAP_READER_BUFFER_CAPACITY, stream);
                    let mut line = String::new();
                    let mut batch = Vec::with_capacity(TAP_EMIT_BATCH_MAX_LINES);
                    let mut batch_bytes = 0usize;

                    // Read loop — process JSONL lines until EOF or stop.
                    // Drain lines already in BufReader's memory into one UI event.
                    loop {
                        if should_stop(&stop_for_thread) {
                            break;
                        }

                        match reader.read_line(&mut line) {
                            Ok(0) => break, // EOF — client disconnected
                            Ok(_) => {
                                push_tap_line(&mut batch, &mut batch_bytes, &line);
                                line.clear();

                                let mut read_failed = false;
                                while batch.len() < TAP_EMIT_BATCH_MAX_LINES
                                    && batch_bytes < TAP_EMIT_BATCH_MAX_BYTES
                                    && reader.buffer().contains(&b'\n')
                                {
                                    match reader.read_line(&mut line) {
                                        Ok(0) => break,
                                        Ok(_) => {
                                            push_tap_line(&mut batch, &mut batch_bytes, &line);
                                            line.clear();
                                        }
                                        Err(err) => {
                                            if !should_stop(&stop_for_thread) {
                                                log_tap_read_error(
                                                    &app_for_thread,
                                                    &sid_for_thread,
                                                    &err,
                                                );
                                            }
                                            line.clear();
                                            read_failed = true;
                                            break;
                                        }
                                    }
                                }
                                if read_failed {
                                    break;
                                }

                                emit_tap_batch(
                                    &app_for_thread,
                                    &event_name,
                                    &mut batch,
                                    &mut batch_bytes,
                                );
                            }
                            Err(err) => {
                                if !should_stop(&stop_for_thread) {
                                    log_tap_read_error(&app_for_thread, &sid_for_thread, &err);
                                }
                                break; // Connection error — re-accept
                            }
                        }
                    }

                    emit_tap_batch(&app_for_thread, &event_name, &mut batch, &mut batch_bytes);
                    set_active_client(&state, &sid, None);
                    record_backend_event(
                        &app_for_thread,
                        "LOG",
                        "tap-server",
                        Some(&sid_for_thread),
                        "tap.server.client_disconnected",
                        "Tap client disconnected",
                        serde_json::json!({}),
                    );
                }
                Err(err) => {
                    record_backend_event(
                        &app_for_thread,
                        "ERR",
                        "tap-server",
                        Some(&sid_for_thread),
                        "tap.server.accept_error",
                        "Tap listener accept failed",
                        serde_json::json!({ "error": err.to_string() }),
                    );
                    // Listener error — exit thread
                    break;
                }
            }
        }

        // Cleanup
        if let Ok(mut s) = state.lock() {
            s.active.remove(&sid_for_thread);
        }
        record_backend_event(
            &app_for_thread,
            "LOG",
            "tap-server",
            Some(&sid_for_thread),
            "tap.server.stop",
            "Tap TCP server stopped",
            serde_json::json!({}),
        );
    });

    Ok(port)
}

/// Signal a session's TCP server thread to stop.
#[tauri::command]
pub fn stop_tap_server(
    app: AppHandle,
    session_id: String,
    tap_state: tauri::State<'_, Arc<Mutex<TapServerState>>>,
) {
    let port = tap_state
        .lock()
        .ok()
        .and_then(|mut s| s.stop_session(&session_id));
    if let Some(port) = port {
        wake_tap_listener(port);
    }
    record_backend_event(
        &app,
        "DEBUG",
        "tap-server",
        Some(&session_id),
        "tap.server.stop_requested",
        "Tap TCP server stop requested",
        serde_json::json!({}),
    );
}
