use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct TapServerState {
    active: HashMap<String, bool>, // session_id -> should_stop
}

impl TapServerState {
    pub fn new() -> Self {
        Self {
            active: HashMap::new(),
        }
    }

    /// Set stop flag for all active servers (used on app exit).
    pub fn stop_all(&mut self) {
        for v in self.active.values_mut() {
            *v = true;
        }
    }
}

/// Start a per-session TCP listener. Returns the OS-assigned port.
/// The background thread accepts one connection at a time, reads JSONL lines,
/// and emits each line as a session-scoped Tauri event.
#[tauri::command]
pub fn start_tap_server(
    app: AppHandle,
    session_id: String,
    tap_state: tauri::State<'_, Arc<Mutex<TapServerState>>>,
) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("TCP bind failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr failed: {e}"))?
        .port();

    listener
        .set_nonblocking(true)
        .map_err(|e| format!("set_nonblocking failed: {e}"))?;

    let sid = session_id.clone();
    let state = tap_state.inner().clone();

    // Mark as active
    if let Ok(mut s) = state.lock() {
        s.active.insert(sid.clone(), false);
    }

    let event_name = format!("tap-entry-{sid}");

    std::thread::spawn(move || {
        // Accept loop — one connection at a time, re-accept on disconnect
        loop {
            // Check stop flag
            if let Ok(s) = state.lock() {
                if s.active.get(&sid).copied().unwrap_or(true) {
                    break;
                }
            }

            // Non-blocking accept
            match listener.accept() {
                Ok((stream, addr)) => {
                    eprintln!("[tap_server] connection from {} for session {}", addr, sid);
                    // Set blocking with read timeout for the data stream
                    stream.set_nonblocking(false).ok();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .ok();

                    let mut reader = BufReader::new(stream);
                    let mut line = String::new();

                    // Read loop — process JSONL lines until EOF or stop
                    loop {
                        if let Ok(s) = state.lock() {
                            if s.active.get(&sid).copied().unwrap_or(true) {
                                break;
                            }
                        }

                        match reader.read_line(&mut line) {
                            Ok(0) => break, // EOF — client disconnected
                            Ok(_) => {
                                let trimmed = line.trim();
                                if !trimmed.is_empty() {
                                    app.emit(&event_name, trimmed).ok();
                                }
                                line.clear();
                            }
                            Err(ref e)
                                if e.kind() == std::io::ErrorKind::WouldBlock
                                    || e.kind() == std::io::ErrorKind::TimedOut =>
                            {
                                // Read timeout — check stop flag and continue
                                line.clear();
                                continue;
                            }
                            Err(_) => break, // Connection error — re-accept
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // No connection yet — sleep and retry
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(_) => {
                    // Listener error — exit thread
                    break;
                }
            }
        }

        // Cleanup
        if let Ok(mut s) = state.lock() {
            s.active.remove(&sid);
        }
    });

    Ok(port)
}

/// Signal a session's TCP server thread to stop.
#[tauri::command]
pub fn stop_tap_server(
    session_id: String,
    tap_state: tauri::State<'_, Arc<Mutex<TapServerState>>>,
) {
    if let Ok(mut s) = tap_state.lock() {
        if let Some(flag) = s.active.get_mut(&session_id) {
            *flag = true;
        }
    }
}
