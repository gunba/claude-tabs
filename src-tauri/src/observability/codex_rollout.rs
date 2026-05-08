//! Codex session observability via rollout-file tailing.
//!
//! The user runs `codex` interactively in xterm — same shape as a
//! Claude session. We can't attach to Codex over JSON-RPC the way
//! `codex app-server` clients do (the app-server drives its own
//! sessions; it doesn't observe a TUI session). What Codex *does* do
//! during a TUI session is append every turn, tool call, token-count
//! update, and approval to a per-session rollout JSONL at:
//!
//!   `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`
//!
//! That file is the structured event source. This module:
//!   1. Watches the Codex sessions tree for rollout files.
//!   2. Attributes a rollout only by deterministic identity: the
//!      expected Codex conversation id for resumes, or the session-scoped
//!      model provider id injected into this launch.
//!   3. Tails the file, parsing each line as a `RolloutItem` and
//!      writing a normalized envelope into `observability.jsonl` via
//!      `record_backend_event` — the same sink the Claude tap pipeline
//!      uses.
//!
//! Wire shape per line in the rollout file (confirmed against
//! `~/.codex/sessions/2025/11/18/...`):
//!
//!   { "timestamp": "ISO8601", "type": "session_meta" | "response_item"
//!     | "event_msg" | "compacted" | "turn_context", "payload": {...} }

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::OnceLock;

#[cfg(not(target_os = "windows"))]
use notify::Watcher as _;
use notify::{EventKind, RecursiveMode};
use serde::Deserialize;
use serde_json::Value;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{Mutex, Semaphore};

use crate::observability::record_backend_event;

const MAX_CONCURRENT_TAILS: usize = 64;
const MAX_QUARANTINE_LINE_BYTES: usize = 1024;
#[cfg(target_os = "windows")]
const WINDOWS_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(750);
static TAIL_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();
static CODEX_ROLLOUT_UUID_RE: OnceLock<regex::Regex> = OnceLock::new();

fn tail_semaphore() -> Arc<Semaphore> {
    TAIL_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_TAILS)))
        .clone()
}

#[derive(Clone, Debug, Default)]
struct RolloutAttributionCriteria {
    expected_codex_session_id: Option<String>,
    expected_model_provider: Option<String>,
}

#[derive(Debug, Default)]
struct RolloutMetadata {
    codex_session_id: Option<String>,
    model_provider: Option<String>,
}

#[derive(Debug)]
struct ClaimedRollout {
    path: PathBuf,
    previous_owner: Option<String>,
}

/// Build a notify watcher appropriate for the host OS. On Windows we use
/// `PollWatcher` because `ReadDirectoryChangesW` (the backend behind
/// `notify::recommended_watcher` on Windows) silently drops events for
/// directories under OneDrive sync roots and other redirected/roaming
/// profile paths — which is exactly where `~/.codex/sessions/...` lives
/// for many corporate users. On Linux/macOS the platform-native backend
/// (inotify / FSEvents) is reliable and is kept.
// [CR-04] build_watcher: PollWatcher on Windows (WINDOWS_POLL_INTERVAL=750ms) / RecommendedWatcher elsewhere; works around ReadDirectoryChangesW silently dropping events on OneDrive-redirected ~/.codex
fn build_watcher<F>(handler: F) -> notify::Result<Box<dyn notify::Watcher + Send>>
where
    F: notify::EventHandler,
{
    #[cfg(target_os = "windows")]
    {
        let cfg = notify::Config::default().with_poll_interval(WINDOWS_POLL_INTERVAL);
        Ok(Box::new(notify::PollWatcher::new(handler, cfg)?))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Box::new(notify::RecommendedWatcher::new(
            handler,
            notify::Config::default(),
        )?))
    }
}

struct RolloutDirWatcher {
    tx: tokio::sync::mpsc::UnboundedSender<RolloutDirWatcherCommand>,
    next_interest_id: AtomicU64,
}

enum RolloutDirWatcherCommand {
    Register {
        id: u64,
        session_id: String,
        criteria: RolloutAttributionCriteria,
        reply: tokio::sync::oneshot::Sender<PathBuf>,
    },
    Unregister {
        id: u64,
    },
    Notify {
        paths: Vec<PathBuf>,
    },
}

impl RolloutDirWatcher {
    fn start(
        dir: PathBuf,
        claimed_rollouts: Arc<Mutex<HashMap<PathBuf, String>>>,
    ) -> Result<Arc<Self>, String> {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<RolloutDirWatcherCommand>();
        let tx_for_notify = tx.clone();
        let dir_for_log = dir.clone();
        let mut watcher = build_watcher(move |res: notify::Result<notify::Event>| match res {
            Ok(ev) => {
                if matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                    let _ =
                        tx_for_notify.send(RolloutDirWatcherCommand::Notify { paths: ev.paths });
                }
            }
            Err(e) => {
                // No AppHandle available here (the dir watcher is shared
                // across sessions). At minimum surface the error to
                // stderr so it's not completely silent — without this the
                // OneDrive failure mode that motivated this watcher being
                // PollWatcher on Windows would be invisible.
                eprintln!(
                    "codex.rollout dir watcher error on {dir:?}: {e}",
                    dir = dir_for_log
                );
            }
        })
        .map_err(|e| format!("notify watcher: {e}"))?;
        watcher
            .watch(&dir, RecursiveMode::Recursive)
            .map_err(|e| format!("notify watch {dir:?}: {e}"))?;

        tokio::spawn(run_rollout_dir_watcher(rx, watcher, claimed_rollouts));
        Ok(Arc::new(Self {
            tx,
            next_interest_id: AtomicU64::new(1),
        }))
    }

    fn next_id(&self) -> u64 {
        self.next_interest_id.fetch_add(1, Ordering::Relaxed)
    }
}

async fn run_rollout_dir_watcher(
    mut rx: tokio::sync::mpsc::UnboundedReceiver<RolloutDirWatcherCommand>,
    _watcher: Box<dyn notify::Watcher + Send>,
    claimed_rollouts: Arc<Mutex<HashMap<PathBuf, String>>>,
) {
    let mut interests: HashMap<
        u64,
        (
            RolloutAttributionCriteria,
            String,
            tokio::sync::oneshot::Sender<PathBuf>,
        ),
    > = HashMap::new();
    while let Some(command) = rx.recv().await {
        match command {
            RolloutDirWatcherCommand::Register {
                id,
                session_id,
                criteria,
                reply,
            } => {
                interests.insert(id, (criteria, session_id, reply));
            }
            RolloutDirWatcherCommand::Unregister { id } => {
                interests.remove(&id);
            }
            RolloutDirWatcherCommand::Notify { paths } => {
                let ids: Vec<u64> = interests.keys().copied().collect();
                for id in ids {
                    let Some((criteria, session_id, _)) = interests.get(&id) else {
                        continue;
                    };
                    let Some(claimed) = claim_matching_rollout_paths(
                        paths.clone(),
                        session_id,
                        criteria,
                        &claimed_rollouts,
                    )
                    .await
                    else {
                        continue;
                    };
                    if let Some((_, _, reply)) = interests.remove(&id) {
                        let _ = reply.send(claimed.path);
                    }
                }
            }
        }
    }
}

#[derive(Debug, Deserialize)]
struct RolloutLine {
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug)]
enum RolloutParseError {
    BadJson(String),
    MissingType,
    MissingPayload,
}

impl RolloutParseError {
    fn kind(&self) -> &'static str {
        match self {
            RolloutParseError::BadJson(_) => "bad_json",
            RolloutParseError::MissingType => "missing_type",
            RolloutParseError::MissingPayload => "missing_payload",
        }
    }

    fn message(&self) -> String {
        match self {
            RolloutParseError::BadJson(error) => error.clone(),
            RolloutParseError::MissingType => "missing rollout type".into(),
            RolloutParseError::MissingPayload => "missing rollout payload".into(),
        }
    }
}

fn parse_rollout_line(line: &str) -> Result<RolloutLine, RolloutParseError> {
    let value: Value =
        serde_json::from_str(line).map_err(|e| RolloutParseError::BadJson(e.to_string()))?;
    let timestamp = value
        .get("timestamp")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let kind = value
        .get("type")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(RolloutParseError::MissingType)?
        .to_string();
    let payload = value
        .get("payload")
        .cloned()
        .ok_or(RolloutParseError::MissingPayload)?;
    Ok(RolloutLine {
        timestamp,
        kind,
        payload,
    })
}

/// Resolve `$CODEX_HOME` honoring the env override; default to
/// `~/.codex`. Mirrors what the Codex binary itself does.
fn codex_home() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CODEX_HOME") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    dirs::home_dir().map(|h| h.join(".codex"))
}

fn sessions_root() -> Option<PathBuf> {
    codex_home().map(|home| home.join("sessions"))
}

fn codex_id_from_rollout_filename(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let re = CODEX_ROLLOUT_UUID_RE.get_or_init(|| {
        regex::Regex::new(
            r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$",
        )
        .unwrap()
    });
    re.captures(stem)
        .and_then(|captures| captures.get(1))
        .map(|m| m.as_str().to_string())
}

fn is_rollout_path(path: &Path) -> bool {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    name.starts_with("rollout-") && name.ends_with(".jsonl")
}

fn read_rollout_metadata(path: &Path) -> Option<RolloutMetadata> {
    let file = std::fs::File::open(path).ok()?;
    use std::io::BufRead;
    let reader = std::io::BufReader::new(file);
    for line in reader.lines().take(64).map_while(Result::ok) {
        let parsed = match parse_rollout_line(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if parsed.kind != "session_meta" {
            continue;
        }
        return Some(RolloutMetadata {
            codex_session_id: parsed
                .payload
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned),
            model_provider: parsed
                .payload
                .get("model_provider")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned),
        });
    }
    None
}

fn matches_expected_codex_id(
    path: &Path,
    metadata: Option<&RolloutMetadata>,
    expected: &str,
) -> bool {
    codex_id_from_rollout_filename(path)
        .as_deref()
        .is_some_and(|id| id.eq_ignore_ascii_case(expected))
        || metadata
            .and_then(|m| m.codex_session_id.as_deref())
            .is_some_and(|id| id.eq_ignore_ascii_case(expected))
}

fn rollout_match_rank(path: &Path, criteria: &RolloutAttributionCriteria) -> Option<u8> {
    if !is_rollout_path(path) {
        return None;
    }
    let metadata = read_rollout_metadata(path);
    let codex_id_matches = criteria
        .expected_codex_session_id
        .as_deref()
        .is_some_and(|expected| matches_expected_codex_id(path, metadata.as_ref(), expected));
    let provider_matches = criteria
        .expected_model_provider
        .as_deref()
        .is_some_and(|expected| {
            metadata
                .as_ref()
                .and_then(|m| m.model_provider.as_deref())
                .is_some_and(|provider| provider == expected)
        });

    match (
        criteria.expected_codex_session_id.is_some(),
        criteria.expected_model_provider.is_some(),
    ) {
        (true, true) if codex_id_matches && provider_matches => Some(0),
        (true, true) if codex_id_matches => Some(1),
        (true, false) if codex_id_matches => Some(0),
        (false, true) if provider_matches => Some(0),
        _ => None,
    }
}

fn collect_rollout_files(root: &Path) -> Vec<PathBuf> {
    if !root.exists() {
        return Vec::new();
    }
    let mut stack = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for ent in entries.flatten() {
            let path = ent.path();
            if path.is_dir() {
                stack.push(path);
            } else if is_rollout_path(&path) {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

fn find_matching_rollout(
    root: &Path,
    criteria: &RolloutAttributionCriteria,
    claimed: &HashMap<PathBuf, String>,
) -> Option<PathBuf> {
    collect_rollout_files(root)
        .into_iter()
        .filter(|path| !claimed.contains_key(path))
        .filter_map(|path| rollout_match_rank(&path, criteria).map(|rank| (rank, path)))
        .min_by(|(rank_a, path_a), (rank_b, path_b)| {
            rank_a.cmp(rank_b).then_with(|| path_a.cmp(path_b))
        })
        .map(|(_, path)| path)
}

async fn claim_matching_rollout(
    root: &Path,
    session_id: &str,
    criteria: &RolloutAttributionCriteria,
    claimed_rollouts: &Arc<Mutex<HashMap<PathBuf, String>>>,
) -> Option<ClaimedRollout> {
    let root = root.to_path_buf();
    let criteria = criteria.clone();
    let mut claimed_snapshot = claimed_rollouts.lock().await.clone();
    claimed_snapshot.retain(|_, owner| owner != session_id);
    let path = tokio::task::spawn_blocking(move || {
        find_matching_rollout(&root, &criteria, &claimed_snapshot)
    })
    .await
    .ok()
    .flatten()?;
    let mut claimed = claimed_rollouts.lock().await;
    if claimed.get(&path).is_some_and(|owner| owner != session_id) {
        return None;
    }
    let previous_owner = claimed.insert(path.clone(), session_id.to_string());
    Some(ClaimedRollout {
        path,
        previous_owner,
    })
}

fn find_matching_rollout_in_paths(
    paths: &[PathBuf],
    criteria: &RolloutAttributionCriteria,
    claimed: &HashMap<PathBuf, String>,
) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for path in paths {
        if path.is_dir() {
            candidates.extend(collect_rollout_files(path));
        } else if is_rollout_path(path) {
            candidates.push(path.clone());
        }
    }
    candidates.sort();
    candidates.dedup();
    candidates
        .into_iter()
        .filter(|path| !claimed.contains_key(path))
        .filter_map(|path| rollout_match_rank(&path, criteria).map(|rank| (rank, path)))
        .min_by(|(rank_a, path_a), (rank_b, path_b)| {
            rank_a.cmp(rank_b).then_with(|| path_a.cmp(path_b))
        })
        .map(|(_, path)| path)
}

async fn claim_matching_rollout_paths(
    paths: Vec<PathBuf>,
    session_id: &str,
    criteria: &RolloutAttributionCriteria,
    claimed_rollouts: &Arc<Mutex<HashMap<PathBuf, String>>>,
) -> Option<ClaimedRollout> {
    if paths.is_empty() {
        return None;
    }
    let criteria = criteria.clone();
    let mut claimed_snapshot = claimed_rollouts.lock().await.clone();
    claimed_snapshot.retain(|_, owner| owner != session_id);
    let path = tokio::task::spawn_blocking(move || {
        find_matching_rollout_in_paths(&paths, &criteria, &claimed_snapshot)
    })
    .await
    .ok()
    .flatten()?;
    let mut claimed = claimed_rollouts.lock().await;
    if claimed.get(&path).is_some_and(|owner| owner != session_id) {
        return None;
    }
    let previous_owner = claimed.insert(path.clone(), session_id.to_string());
    Some(ClaimedRollout {
        path,
        previous_owner,
    })
}

/// Start a watcher that tails the rollout file for `session_id` and
/// emits normalized events into `observability.jsonl`. Returns a
/// handle that, when dropped, stops the watcher.
// [CR-02] deterministic watcher: match rollout files by expected Codex id/provider id, then tail_rollout; handle inserted before spawn to prevent start/stop race
fn start_codex_rollout_watcher(
    app: tauri::AppHandle,
    session_id: String,
    criteria: RolloutAttributionCriteria,
    claimed_rollouts: Arc<Mutex<HashMap<PathBuf, String>>>,
    dir_watchers: Arc<Mutex<HashMap<PathBuf, Arc<RolloutDirWatcher>>>>,
) -> CodexRolloutHandle {
    // Build the channel and the handle *before* spawning so the
    // caller can put the handle into its registry before the watcher
    // task gets a chance to run. Without this ordering, a respawn
    // that calls stop immediately after start can race past an empty
    // map and leave the new watcher running unsupervised.
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let session_id_for_task = session_id.clone();
    let app_for_task = app.clone();
    tokio::spawn(async move {
        if let Err(e) = run_watcher(
            app_for_task.clone(),
            session_id_for_task.clone(),
            criteria,
            claimed_rollouts,
            dir_watchers,
            stop_rx,
        )
        .await
        {
            record_backend_event(
                &app_for_task,
                "WARN",
                "codex.rollout",
                Some(&session_id_for_task),
                "codex.rollout.watcher_failed",
                "Codex rollout watcher exited with error",
                serde_json::json!({ "error": e }),
            );
        }
    });
    let _ = session_id; // kept for symmetry with future logging hooks
    CodexRolloutHandle {
        stop_tx: Mutex::new(Some(stop_tx)),
    }
}

pub struct CodexRolloutHandle {
    stop_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl CodexRolloutHandle {
    pub async fn stop(&self) {
        if let Some(tx) = self.stop_tx.lock().await.take() {
            let _ = tx.send(());
        }
    }
}

/// App-state registry of active Codex rollout watchers, keyed by
/// code-tabs session id (NOT the Codex conversation id, which we
/// don't know until the rollout file is attributed).
#[derive(Default)]
pub struct CodexRolloutState {
    watchers: Mutex<HashMap<String, Arc<CodexRolloutHandle>>>,
    claimed_rollouts: Arc<Mutex<HashMap<PathBuf, String>>>,
    dir_watchers: Arc<Mutex<HashMap<PathBuf, Arc<RolloutDirWatcher>>>>,
}

// [CR-03] start_codex_rollout/stop_codex_rollout: CodexRolloutState registry keyed by session_id; handle inserted before spawn for stop-race safety
#[tauri::command]
pub async fn start_codex_rollout(
    session_id: String,
    expected_codex_session_id: Option<String>,
    expected_model_provider: Option<String>,
    state: tauri::State<'_, CodexRolloutState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let criteria = RolloutAttributionCriteria {
        expected_codex_session_id: expected_codex_session_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        expected_model_provider: expected_model_provider
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    };
    if criteria.expected_codex_session_id.is_none() && criteria.expected_model_provider.is_none() {
        return Err(
            "codex rollout attribution requires an expected session id or provider id".into(),
        );
    }

    // Insert the handle into the registry *before* the watcher task
    // gets to run. tokio::spawn doesn't promise that the spawned
    // future is suspended before the calling fn returns; serializing
    // through the lock here means a follow-up stop_codex_rollout call
    // sees the new handle instead of an empty slot.
    let handle = Arc::new(start_codex_rollout_watcher(
        app.clone(),
        session_id.clone(),
        criteria,
        state.claimed_rollouts.clone(),
        state.dir_watchers.clone(),
    ));
    let prior = {
        let mut map = state.watchers.lock().await;
        map.insert(session_id.clone(), handle)
    };
    if let Some(prev) = prior {
        prev.stop().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_codex_rollout(
    session_id: String,
    state: tauri::State<'_, CodexRolloutState>,
) -> Result<(), String> {
    let handle = {
        let mut map = state.watchers.lock().await;
        map.remove(&session_id)
    };
    if let Some(h) = handle {
        h.stop().await;
    }
    state
        .claimed_rollouts
        .lock()
        .await
        .retain(|_, owner| owner != &session_id);
    Ok(())
}

async fn run_watcher(
    app: tauri::AppHandle,
    session_id: String,
    criteria: RolloutAttributionCriteria,
    claimed_rollouts: Arc<Mutex<HashMap<PathBuf, String>>>,
    dir_watchers: Arc<Mutex<HashMap<PathBuf, Arc<RolloutDirWatcher>>>>,
    mut stop_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let root = sessions_root().ok_or("could not resolve $CODEX_HOME/sessions")?;
    let root_existed_before = root.exists();
    std::fs::create_dir_all(&root).map_err(|e| format!("create rollout sessions root: {e}"))?;

    record_backend_event(
        &app,
        "DEBUG",
        "codex.rollout",
        Some(&session_id),
        "codex.rollout.watcher_armed",
        "Codex rollout watcher armed",
        serde_json::json!({
            "root": root.to_string_lossy(),
            "expectedCodexSessionId": criteria.expected_codex_session_id.as_deref(),
            "expectedModelProvider": criteria.expected_model_provider.as_deref(),
            "windows": cfg!(target_os = "windows"),
            "rootExistedBefore": root_existed_before,
        }),
    );

    let claimed_rollout =
        match claim_matching_rollout(&root, &session_id, &criteria, &claimed_rollouts).await {
            Some(claimed) => Some(claimed),
            None => wait_for_matching_rollout(
                &root,
                &session_id,
                &criteria,
                &claimed_rollouts,
                &dir_watchers,
                &mut stop_rx,
            )
            .await?
            .map(|path| ClaimedRollout {
                path,
                previous_owner: None,
            }),
        };
    let claimed_rollout = match claimed_rollout {
        Some(claimed) => claimed,
        None => return Ok(()), // stop signaled
    };
    let ClaimedRollout {
        path: file_path,
        previous_owner,
    } = claimed_rollout;

    if let Ok(dir) = crate::commands::data::get_session_data_dir(&session_id) {
        let _ = std::fs::write(
            dir.join("codex-rollout-path.txt"),
            file_path.to_string_lossy().as_bytes(),
        );
    }

    record_backend_event(
        &app,
        "DEBUG",
        "codex.rollout",
        Some(&session_id),
        "codex.rollout.attributed",
        "Attributed Codex rollout file to session",
        serde_json::json!({
            "path": file_path.to_string_lossy(),
            "expectedCodexSessionId": criteria.expected_codex_session_id.as_deref(),
            "expectedModelProvider": criteria.expected_model_provider.as_deref(),
            "previousOwner": previous_owner,
        }),
    );

    tail_rollout(&app, &session_id, &file_path, &mut stop_rx).await
}

/// Block until either (a) a matching rollout-*.jsonl appears under
/// `root`, or stop is signaled. Returns Some(path) or None on stop.
async fn wait_for_matching_rollout(
    root: &Path,
    session_id: &str,
    criteria: &RolloutAttributionCriteria,
    claimed_rollouts: &Arc<Mutex<HashMap<PathBuf, String>>>,
    dir_watchers: &Arc<Mutex<HashMap<PathBuf, Arc<RolloutDirWatcher>>>>,
    stop_rx: &mut tokio::sync::oneshot::Receiver<()>,
) -> Result<Option<PathBuf>, String> {
    let watcher = rollout_dir_watcher_for(root, claimed_rollouts, dir_watchers).await?;
    let interest_id = watcher.next_id();
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel::<PathBuf>();
    watcher
        .tx
        .send(RolloutDirWatcherCommand::Register {
            id: interest_id,
            session_id: session_id.to_string(),
            criteria: criteria.clone(),
            reply: reply_tx,
        })
        .map_err(|_| "rollout directory watcher closed".to_string())?;

    if let Some(claimed) =
        claim_matching_rollout(root, session_id, criteria, claimed_rollouts).await
    {
        let _ = watcher
            .tx
            .send(RolloutDirWatcherCommand::Unregister { id: interest_id });
        return Ok(Some(claimed.path));
    }

    tokio::select! {
        result = reply_rx => {
            result
                .map(Some)
                .map_err(|_| "rollout directory watcher closed before rollout file appeared".into())
        }
        _ = &mut *stop_rx => {
            let _ = watcher
                .tx
                .send(RolloutDirWatcherCommand::Unregister { id: interest_id });
            Ok(None)
        }
    }
}

async fn rollout_dir_watcher_for(
    dir: &Path,
    claimed_rollouts: &Arc<Mutex<HashMap<PathBuf, String>>>,
    dir_watchers: &Arc<Mutex<HashMap<PathBuf, Arc<RolloutDirWatcher>>>>,
) -> Result<Arc<RolloutDirWatcher>, String> {
    let mut watchers = dir_watchers.lock().await;
    if let Some(watcher) = watchers.get(dir) {
        return Ok(watcher.clone());
    }
    let watcher = RolloutDirWatcher::start(dir.to_path_buf(), claimed_rollouts.clone())?;
    watchers.insert(dir.to_path_buf(), watcher.clone());
    Ok(watcher)
}

async fn tail_rollout(
    app: &tauri::AppHandle,
    session_id: &str,
    path: &Path,
    stop_rx: &mut tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let _tail_permit = tail_semaphore()
        .acquire_owned()
        .await
        .map_err(|e| format!("tail semaphore closed: {e}"))?;
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("open rollout {path:?}: {e}"))?;
    let mut reader = BufReader::new(file);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let watch_path = path.to_path_buf();
    let app_for_notify = app.clone();
    let session_id_for_notify = session_id.to_string();
    let watch_path_for_notify = watch_path.clone();
    let notify_err_seen = std::sync::atomic::AtomicBool::new(false);
    let mut watcher = build_watcher(move |res: notify::Result<notify::Event>| match res {
        Ok(ev) => {
            if matches!(ev.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                let _ = tx.send(());
            }
        }
        Err(e) => {
            // First failure per tail emits a backend event so it shows up
            // in observability.jsonl alongside the other codex.rollout.*
            // entries. Subsequent failures are swallowed to avoid log
            // flooding when a backend is permanently unhappy.
            if !notify_err_seen.swap(true, std::sync::atomic::Ordering::Relaxed) {
                record_backend_event(
                    &app_for_notify,
                    "WARN",
                    "codex.rollout",
                    Some(&session_id_for_notify),
                    "codex.rollout.notify_error",
                    "Notify watcher reported an error while tailing rollout",
                    serde_json::json!({
                        "path": watch_path_for_notify.to_string_lossy(),
                        "error": e.to_string(),
                    }),
                );
            }
        }
    })
    .map_err(|e| format!("notify watcher: {e}"))?;
    watcher
        .watch(&watch_path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("notify watch {watch_path:?}: {e}"))?;

    let app_arc = Arc::new(app.clone());
    let mut prompt_state = CodexPromptCaptureState::default();
    loop {
        // Drain whatever is currently readable.
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line).await {
                Ok(0) => break, // EOF; wait for more
                Ok(_) => {
                    handle_rollout_line(&app_arc, session_id, line.trim_end(), &mut prompt_state);
                }
                Err(e) => {
                    return Err(format!("read rollout: {e}"));
                }
            }
        }
        tokio::select! {
            recv = rx.recv() => {
                if recv.is_none() {
                    return Err("notify watcher closed while tailing rollout".into());
                }
                continue;
            }
            _ = &mut *stop_rx => return Ok(()),
        }
    }
}

// [CX-02] Codex prompt capture state: base_instructions captured from session_meta; developer/user instructions captured from turn_context, deduped by stable joined-string key.
#[derive(Default)]
struct CodexPromptCaptureState {
    base_instructions: Option<String>,
    last_capture_key: Option<u64>,
    parse_error_count: u64,
}

impl CodexPromptCaptureState {
    fn should_emit_parse_warn(&mut self) -> bool {
        self.parse_error_count = self.parse_error_count.saturating_add(1);
        self.parse_error_count <= 5 || self.parse_error_count % 100 == 0
    }
}

fn handle_rollout_line(
    app: &tauri::AppHandle,
    session_id: &str,
    line: &str,
    prompt_state: &mut CodexPromptCaptureState,
) {
    if line.is_empty() {
        return;
    }
    let parsed = match parse_rollout_line(line) {
        Ok(p) => p,
        Err(e) => {
            let quarantine_path = append_rollout_quarantine(session_id, line, &e).ok();
            if prompt_state.should_emit_parse_warn() {
                record_backend_event(
                    app,
                    "WARN",
                    "codex.rollout",
                    Some(session_id),
                    "codex.rollout.parse_failed",
                    "Failed to parse rollout line",
                    serde_json::json!({
                        "errorKind": e.kind(),
                        "error": e.message(),
                        "len": line.len(),
                        "quarantinePath": quarantine_path,
                        "suppressedCount": prompt_state.parse_error_count.saturating_sub(1),
                    }),
                );
            }
            return;
        }
    };
    emit_normalized(app, session_id, &parsed, prompt_state);
}

fn append_rollout_quarantine(
    session_id: &str,
    line: &str,
    error: &RolloutParseError,
) -> Result<PathBuf, String> {
    let dir = crate::commands::data::get_session_data_dir(session_id)?;
    let path = dir.join("codex-rollout-quarantine.jsonl");
    let raw = if line.len() > MAX_QUARANTINE_LINE_BYTES {
        let truncated: String = line.chars().take(MAX_QUARANTINE_LINE_BYTES).collect();
        format!("{truncated}...")
    } else {
        line.to_string()
    };
    let entry = serde_json::json!({
        "ts": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "errorKind": error.kind(),
        "error": error.message(),
        "raw": raw,
        "rawLen": line.len(),
    });
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open rollout quarantine: {e}"))?;
    writeln!(file, "{entry}").map_err(|e| format!("write rollout quarantine: {e}"))?;
    Ok(path)
}

fn rollout_ts_millis(ts: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis())
}

fn parsed_str<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
}

// [CX-04] Codex collab event_msg records become subagent tap events; exec_command_end carries parsedCmd/cwd/status for activity tracking.
fn emit_codex_subagent_status(
    app: &tauri::AppHandle,
    session_id: &str,
    ts: &str,
    call_id: Option<&Value>,
    agent_id: &str,
    nickname: Option<&Value>,
    role: Option<&Value>,
    status: &Value,
    source: &str,
) {
    if agent_id.is_empty() {
        return;
    }
    emit_tap_entry(
        app,
        session_id,
        ts,
        serde_json::json!({
            "cat": "codex-subagent-status",
            "callId": call_id,
            "agentId": agent_id,
            "nickname": nickname,
            "role": role,
            "status": status,
            "source": source,
        }),
    );
}

// [CX-01] emit_tap_entry publishes 'tap-entry-{sid}' events with codex-* cats; function_call/custom_tool_call dual-handled; dual emit (tool-call-start + tool-input) for tool calls
fn emit_tap_entry(app: &tauri::AppHandle, session_id: &str, ts: &str, mut entry: Value) {
    let Some(obj) = entry.as_object_mut() else {
        return;
    };
    obj.insert("ts".into(), Value::Number(rollout_ts_millis(ts).into()));
    obj.insert("tsIso".into(), Value::String(ts.to_string()));
    let event_name = format!("tap-entry-{session_id}");
    if let Ok(line) = serde_json::to_string(&entry) {
        let _ = app.emit(&event_name, line);
    }
}

/// Translate a `RolloutItem` into one (or more) `record_backend_event`
/// calls. The taxonomy mirrors what tap classifier emits for Claude.
fn emit_normalized(
    app: &tauri::AppHandle,
    session_id: &str,
    parsed: &RolloutLine,
    prompt_state: &mut CodexPromptCaptureState,
) {
    let ts = parsed.timestamp.clone().unwrap_or_default();
    match parsed.kind.as_str() {
        "session_meta" => {
            let id = parsed
                .payload
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let cwd = parsed
                .payload
                .get("cwd")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let cli_version = parsed
                .payload
                .get("cli_version")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if let Some(text) = parsed
                .payload
                .get("base_instructions")
                .and_then(|v| v.get("text"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                prompt_state.base_instructions = Some(text.to_string());
                record_backend_event(
                    app,
                    "LOG",
                    "codex.rollout",
                    Some(session_id),
                    "codex.system_prompt",
                    "Codex system instructions captured",
                    serde_json::json!({
                        "ts": ts,
                        "codexSessionId": id,
                        "text": text,
                        "length": text.len(),
                    }),
                );
            }
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.session_started",
                "Codex session started",
                serde_json::json!({
                    "ts": ts,
                    "codexSessionId": id,
                    "cwd": cwd,
                    "cliVersion": cli_version,
                }),
            );
            emit_tap_entry(
                app,
                session_id,
                &ts,
                serde_json::json!({
                    "cat": "codex-session",
                    "codexSessionId": id,
                    "cwd": cwd,
                    "cliVersion": cli_version,
                }),
            );
        }
        "turn_context" => {
            emit_codex_prompt_capture(app, session_id, &ts, &parsed.payload, prompt_state);
            record_backend_event(
                app,
                "DEBUG",
                "codex.rollout",
                Some(session_id),
                "codex.turn_context",
                "Turn context",
                serde_json::json!({
                    "ts": ts,
                    "payload": &parsed.payload,
                }),
            );
            emit_tap_entry(
                app,
                session_id,
                &ts,
                serde_json::json!({
                    "cat": "codex-turn-context",
                    "cwd": parsed.payload.get("cwd"),
                    "approvalPolicy": parsed.payload.get("approval_policy"),
                    "sandboxPolicy": parsed.payload.get("sandbox_policy"),
                    "model": parsed.payload.get("model"),
                    "effort": parsed.payload.get("effort"),
                }),
            );
        }
        "event_msg" => emit_event_msg(app, session_id, &ts, &parsed.payload),
        "response_item" => emit_response_item(app, session_id, &ts, &parsed.payload),
        "compacted" => {
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.compacted",
                "Conversation compacted",
                serde_json::json!({ "ts": ts, "payload": &parsed.payload }),
            );
            emit_tap_entry(
                app,
                session_id,
                &ts,
                serde_json::json!({ "cat": "codex-compacted", "payload": &parsed.payload }),
            );
        }
        other => {
            record_backend_event(
                app,
                "DEBUG",
                "codex.rollout",
                Some(session_id),
                "codex.rollout.unknown_kind",
                "Unknown rollout item type",
                serde_json::json!({ "ts": ts, "kind": other }),
            );
        }
    }
}

fn turn_context_developer_instructions(payload: &Value) -> Option<&str> {
    payload
        .get("collaboration_mode")
        .and_then(|v| v.get("settings"))
        .and_then(|v| v.get("developer_instructions"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
}

fn turn_context_user_instructions(payload: &Value) -> Option<&str> {
    payload
        .get("user_instructions")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
}

fn text_message(role: &str, text: &str) -> Value {
    serde_json::json!({
        "role": role,
        "content": [{ "type": "text", "text": text }],
    })
}

fn hash_json_canonical<H: Hasher>(value: &Value, state: &mut H) {
    match value {
        Value::Null => {
            0u8.hash(state);
        }
        Value::Bool(v) => {
            1u8.hash(state);
            v.hash(state);
        }
        Value::Number(v) => {
            2u8.hash(state);
            v.to_string().hash(state);
        }
        Value::String(v) => {
            3u8.hash(state);
            v.hash(state);
        }
        Value::Array(items) => {
            4u8.hash(state);
            items.len().hash(state);
            for item in items {
                hash_json_canonical(item, state);
            }
        }
        Value::Object(map) => {
            5u8.hash(state);
            map.len().hash(state);
            let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
            keys.sort_unstable();
            for key in keys {
                key.hash(state);
                if let Some(item) = map.get(key) {
                    hash_json_canonical(item, state);
                }
            }
        }
    }
}

fn prompt_capture_key(base: &str, payload: &Value) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    base.hash(&mut hasher);
    hash_json_canonical(payload, &mut hasher);
    hasher.finish()
}

fn emit_codex_prompt_capture(
    app: &tauri::AppHandle,
    session_id: &str,
    ts: &str,
    payload: &Value,
    prompt_state: &mut CodexPromptCaptureState,
) {
    let Some(base) = prompt_state.base_instructions.as_deref() else {
        return;
    };
    if base.is_empty() {
        return;
    }

    let model = payload.get("model").and_then(|v| v.as_str()).unwrap_or("");
    let developer = turn_context_developer_instructions(payload);
    let user = turn_context_user_instructions(payload);
    let capture_key = prompt_capture_key(base, payload);
    if prompt_state.last_capture_key == Some(capture_key) {
        return;
    }
    prompt_state.last_capture_key = Some(capture_key);

    let mut messages = Vec::new();
    if let Some(text) = developer {
        messages.push(text_message("developer", text));
    }
    if let Some(text) = user {
        messages.push(text_message("user", text));
    }
    let message_count = messages.len();

    record_backend_event(
        app,
        "LOG",
        "codex.rollout",
        Some(session_id),
        "codex.prompt_capture",
        "Codex prompt context captured",
        serde_json::json!({
            "ts": ts,
            "model": model,
            "systemInstructionsLength": base.len(),
            "developerInstructionsLength": developer.map(str::len).unwrap_or(0),
            "userInstructionsLength": user.map(str::len).unwrap_or(0),
            "messages": &messages,
        }),
    );
    emit_tap_entry(
        app,
        session_id,
        ts,
        serde_json::json!({
            "cat": "system-prompt",
            "source": "codex-rollout",
            "text": base,
            "model": model,
            "msgCount": message_count,
            "blocks": [{ "text": base }],
            "messages": messages,
        }),
    );
}

fn emit_event_msg(app: &tauri::AppHandle, session_id: &str, ts: &str, payload: &Value) {
    let kind = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match kind {
        // [CX-03] Codex task lifecycle events: task_started/task_complete/turn_aborted -> dedicated codex-task-* tap entries + record_backend_event log entries.
        "task_started" | "turn_started" => {
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-task-started",
                    "turnId": payload.get("turn_id"),
                    "startedAt": payload.get("started_at"),
                }),
            );
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.task_started",
                "Task started",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "task_complete" | "turn_complete" => {
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-task-complete",
                    "turnId": payload.get("turn_id"),
                    "lastAgentMessage": payload.get("last_agent_message"),
                    "durationMs": payload.get("duration_ms"),
                    "completedAt": payload.get("completed_at"),
                }),
            );
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.task_complete",
                "Task complete",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "turn_aborted" => {
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-turn-aborted",
                    "turnId": payload.get("turn_id"),
                    "reason": payload.get("reason"),
                    "durationMs": payload.get("duration_ms"),
                    "completedAt": payload.get("completed_at"),
                }),
            );
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.turn_aborted",
                payload
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("aborted"),
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "token_count" => {
            // payload.info has total_token_usage and last_token_usage,
            // each with input_tokens, cached_input_tokens, output_tokens,
            // reasoning_output_tokens, total_tokens.
            let info = payload.get("info").cloned().unwrap_or_default();
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.token_count",
                "Token usage update",
                serde_json::json!({ "ts": ts, "info": info }),
            );
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-token-count",
                    "info": payload.get("info"),
                    "rateLimits": payload.get("rate_limits"),
                }),
            );
        }
        "session_configured" => {
            if let Some(thread_name) = parsed_str(payload, "thread_name") {
                emit_tap_entry(
                    app,
                    session_id,
                    ts,
                    serde_json::json!({
                        "cat": "codex-thread-name-updated",
                        "codexSessionId": payload.get("thread_id"),
                        "threadName": thread_name,
                    }),
                );
            }
            record_backend_event(
                app,
                "DEBUG",
                "codex.rollout",
                Some(session_id),
                "codex.session_configured",
                "Session configured",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "thread_name_updated" => {
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-thread-name-updated",
                    "codexSessionId": payload.get("thread_id"),
                    "threadName": payload.get("thread_name"),
                }),
            );
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.thread_name_updated",
                "Thread name updated",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "user_message" => {
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-message",
                    "role": "user",
                    "content": [{
                        "type": "input_text",
                        "text": payload.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                    }],
                }),
            );
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.user_message",
                "User message",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "agent_message" => {
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-message",
                    "role": "assistant",
                    "phase": payload.get("phase"),
                    "content": [{
                        "type": "output_text",
                        "text": payload.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                    }],
                }),
            );
            record_backend_event(
                app,
                "DEBUG",
                "codex.rollout",
                Some(session_id),
                "codex.agent_message",
                payload
                    .get("phase")
                    .and_then(|v| v.as_str())
                    .unwrap_or("assistant"),
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "exec_command_end" => {
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.exec_command_end",
                "Command finished",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-tool-call-complete",
                    "callId": payload.get("call_id"),
                    "name": "exec_command",
                    "output": payload.get("aggregated_output"),
                    "exitCode": payload.get("exit_code"),
                    "duration": payload.get("duration"),
                    "command": payload.get("command").and_then(|v| v.as_array()).map(|parts| {
                        parts.iter().filter_map(|part| part.as_str()).collect::<Vec<_>>().join(" ")
                    }),
                    "cwd": payload.get("cwd"),
                    "parsedCmd": payload.get("parsed_cmd"),
                    "source": payload.get("source"),
                    "status": payload.get("status"),
                }),
            );
        }
        "collab_agent_spawn_end" => {
            if let Some(agent_id) = payload.get("new_thread_id").and_then(|v| v.as_str()) {
                emit_tap_entry(
                    app,
                    session_id,
                    ts,
                    serde_json::json!({
                        "cat": "codex-subagent-spawned",
                        "callId": payload.get("call_id"),
                        "parentThreadId": payload.get("sender_thread_id"),
                        "agentId": agent_id,
                        "nickname": payload.get("new_agent_nickname"),
                        "role": payload.get("new_agent_role"),
                        "prompt": payload.get("prompt"),
                        "model": payload.get("model"),
                        "reasoningEffort": payload.get("reasoning_effort"),
                        "status": payload.get("status"),
                    }),
                );
            }
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.collab_agent_spawn_end",
                "Codex subagent spawn finished",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "collab_agent_interaction_end" => {
            let agent_id = payload
                .get("receiver_thread_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            emit_codex_subagent_status(
                app,
                session_id,
                ts,
                payload.get("call_id"),
                agent_id,
                payload.get("receiver_agent_nickname"),
                payload.get("receiver_agent_role"),
                payload.get("status").unwrap_or(&Value::Null),
                "interaction",
            );
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.collab_agent_interaction_end",
                "Codex subagent interaction finished",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "collab_waiting_end" => {
            let mut agent_meta: HashMap<String, (Option<&Value>, Option<&Value>)> = HashMap::new();
            if let Some(entries) = payload.get("agent_statuses").and_then(|v| v.as_array()) {
                for entry in entries {
                    let Some(agent_id) = entry.get("thread_id").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    agent_meta.insert(
                        agent_id.to_string(),
                        (entry.get("agent_nickname"), entry.get("agent_role")),
                    );
                }
            }
            if let Some(statuses) = payload.get("statuses").and_then(|v| v.as_object()) {
                for (agent_id, status) in statuses {
                    let (nickname, role) =
                        agent_meta.get(agent_id).copied().unwrap_or((None, None));
                    emit_codex_subagent_status(
                        app,
                        session_id,
                        ts,
                        payload.get("call_id"),
                        agent_id,
                        nickname,
                        role,
                        status,
                        "wait",
                    );
                }
            }
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.collab_waiting_end",
                "Codex subagent wait finished",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "collab_close_end" | "collab_resume_end" => {
            let agent_id = payload
                .get("receiver_thread_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            emit_codex_subagent_status(
                app,
                session_id,
                ts,
                payload.get("call_id"),
                agent_id,
                payload.get("receiver_agent_nickname"),
                payload.get("receiver_agent_role"),
                payload.get("status").unwrap_or(&Value::Null),
                if kind == "collab_close_end" {
                    "close"
                } else {
                    "resume"
                },
            );
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                if kind == "collab_close_end" {
                    "codex.collab_close_end"
                } else {
                    "codex.collab_resume_end"
                },
                "Codex subagent status changed",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "mcp_tool_call_begin" => {
            let invocation = payload.get("invocation").unwrap_or(&Value::Null);
            let server = invocation
                .get("server")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let tool = invocation
                .get("tool")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let name = format!("mcp__{server}__{tool}");
            let call_id = payload
                .get("call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-tool-call-start",
                    "callId": call_id,
                    "name": name,
                }),
            );
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-tool-input",
                    "callId": call_id,
                    "name": name,
                    "arguments": invocation.get("arguments"),
                }),
            );
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.mcp_tool_call_begin",
                &name,
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        "mcp_tool_call_end" => {
            let call_id = payload
                .get("call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-tool-call-complete",
                    "callId": call_id,
                    "output": payload.get("result"),
                    "duration": payload.get("duration"),
                }),
            );
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.mcp_tool_call_end",
                "MCP tool finished",
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
        _ => {
            record_backend_event(
                app,
                "DEBUG",
                "codex.rollout",
                Some(session_id),
                "codex.event_msg",
                kind,
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
    }
}

fn emit_response_item(app: &tauri::AppHandle, session_id: &str, ts: &str, payload: &Value) {
    let kind = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match kind {
        "function_call" | "custom_tool_call" => {
            let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let call_id = payload
                .get("call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let argument_value = payload.get("arguments");
            if argument_value.is_none() {
                record_backend_event(
                    app,
                    "WARN",
                    "codex.rollout",
                    Some(session_id),
                    "codex.rollout.tool_args_missing",
                    "Tool call arguments field missing",
                    serde_json::json!({
                        "ts": ts,
                        "callId": call_id,
                        "name": name,
                        "usedInputFallback": payload.get("input").is_some(),
                    }),
                );
            }
            let arguments = argument_value
                .or_else(|| payload.get("input"))
                .cloned()
                .unwrap_or(Value::Null);
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.tool_call_start",
                name,
                serde_json::json!({
                    "ts": ts,
                    "callId": call_id,
                    "name": name,
                    "arguments": arguments,
                }),
            );
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-tool-call-start",
                    "callId": call_id,
                    "name": name,
                }),
            );
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-tool-input",
                    "callId": call_id,
                    "name": name,
                    "arguments": arguments,
                    "status": payload.get("status"),
                }),
            );
        }
        "function_call_output" | "custom_tool_call_output" => {
            let call_id = payload
                .get("call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            record_backend_event(
                app,
                "LOG",
                "codex.rollout",
                Some(session_id),
                "codex.tool_call_complete",
                "tool result",
                serde_json::json!({
                    "ts": ts,
                    "callId": call_id,
                    "output": payload.get("output"),
                }),
            );
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-tool-call-complete",
                    "callId": call_id,
                    "output": payload.get("output"),
                }),
            );
        }
        "message" => {
            let role = payload.get("role").and_then(|v| v.as_str()).unwrap_or("");
            record_backend_event(
                app,
                "DEBUG",
                "codex.rollout",
                Some(session_id),
                "codex.message",
                role,
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
            emit_tap_entry(
                app,
                session_id,
                ts,
                serde_json::json!({
                    "cat": "codex-message",
                    "role": role,
                    "content": payload.get("content"),
                }),
            );
        }
        _ => {
            record_backend_event(
                app,
                "DEBUG",
                "codex.rollout",
                Some(session_id),
                "codex.response_item",
                kind,
                serde_json::json!({ "ts": ts, "payload": payload }),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_session_meta_line() {
        let line = r#"{"timestamp":"2025-11-18T09:40:36.766Z","type":"session_meta","payload":{"id":"019a9656-691d-7ff3-890e-3e6678ed46d8","cwd":"/proj","cli_version":"0.58.0"}}"#;
        let parsed: RolloutLine = serde_json::from_str(line).unwrap();
        assert_eq!(parsed.kind, "session_meta");
        assert_eq!(
            parsed.payload.get("id").and_then(|v| v.as_str()),
            Some("019a9656-691d-7ff3-890e-3e6678ed46d8")
        );
    }

    #[test]
    fn parses_token_count_event() {
        let line = r#"{"timestamp":"2025-11-18T09:50:46.482Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":20,"reasoning_output_tokens":10,"total_tokens":120}}}}"#;
        let parsed: RolloutLine = serde_json::from_str(line).unwrap();
        assert_eq!(parsed.kind, "event_msg");
        let info = parsed.payload.get("info").unwrap();
        assert_eq!(
            info.get("total_token_usage")
                .and_then(|t| t.get("total_tokens"))
                .and_then(|v| v.as_i64()),
            Some(120)
        );
    }

    #[test]
    fn parse_rollout_line_reports_missing_payload() {
        let err =
            parse_rollout_line(r#"{"timestamp":"2025-11-18T09:50:46.482Z","type":"event_msg"}"#)
                .unwrap_err();
        assert_eq!(err.kind(), "missing_payload");
    }

    #[test]
    fn prompt_capture_key_uses_canonical_json_order() {
        let a = serde_json::json!({
            "model": "gpt-5.2",
            "tools": [{ "name": "shell", "enabled": true }],
            "sandbox_policy": "workspace-write",
        });
        let b = serde_json::json!({
            "sandbox_policy": "workspace-write",
            "tools": [{ "enabled": true, "name": "shell" }],
            "model": "gpt-5.2",
        });
        assert_eq!(
            prompt_capture_key("base", &a),
            prompt_capture_key("base", &b)
        );
    }

    #[test]
    fn prompt_capture_key_changes_when_unextracted_config_changes() {
        let a = serde_json::json!({
            "model": "gpt-5.2",
            "tools": [{ "name": "shell", "enabled": true }],
        });
        let b = serde_json::json!({
            "model": "gpt-5.2",
            "tools": [{ "name": "shell", "enabled": false }],
        });
        assert_ne!(
            prompt_capture_key("base", &a),
            prompt_capture_key("base", &b)
        );
    }

    fn write_rollout(path: &Path, codex_id: &str, provider: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let line = serde_json::json!({
            "timestamp": "2026-05-08T01:02:03.000Z",
            "type": "session_meta",
            "payload": {
                "id": codex_id,
                "model_provider": provider,
            },
        })
        .to_string();
        std::fs::write(path, format!("{line}\n")).unwrap();
    }

    #[test]
    fn rollout_attribution_matches_exact_model_provider() {
        let tmp = tempfile::tempdir().unwrap();
        let day_dir = tmp.path().join("2026/05/08");
        let other_path = day_dir
            .join("rollout-2026-05-08T01-02-03-000000Z-019a1111-1111-7111-8111-111111111111.jsonl");
        let target_path = day_dir
            .join("rollout-2026-05-08T01-02-04-000000Z-019a2222-2222-7222-8222-222222222222.jsonl");
        write_rollout(&other_path, "019a1111-1111-7111-8111-111111111111", "other");
        write_rollout(
            &target_path,
            "019a2222-2222-7222-8222-222222222222",
            "code-tabs-proxy-session-spawn",
        );

        let criteria = RolloutAttributionCriteria {
            expected_model_provider: Some("code-tabs-proxy-session-spawn".into()),
            ..Default::default()
        };
        let claimed = HashMap::new();
        assert_eq!(
            find_matching_rollout(tmp.path(), &criteria, &claimed),
            Some(target_path)
        );
    }

    #[test]
    fn rollout_attribution_matches_explicit_resume_id() {
        let tmp = tempfile::tempdir().unwrap();
        let target_id = "019a9656-691d-7ff3-890e-3e6678ed46d8";
        let target_path = tmp.path().join(format!(
            "2025/11/18/rollout-2025-11-18T09-40-36-766000Z-{target_id}.jsonl"
        ));
        write_rollout(&target_path, target_id, "openai");

        let criteria = RolloutAttributionCriteria {
            expected_codex_session_id: Some(target_id.into()),
            ..Default::default()
        };
        let claimed = HashMap::new();
        assert_eq!(
            find_matching_rollout(tmp.path(), &criteria, &claimed),
            Some(target_path)
        );
    }

    #[test]
    fn rollout_attribution_prefers_provider_when_resume_id_repeats() {
        let tmp = tempfile::tempdir().unwrap();
        let target_id = "019a9656-691d-7ff3-890e-3e6678ed46d8";
        let old_path = tmp.path().join(format!(
            "2025/11/18/rollout-2025-11-18T09-40-36-766000Z-{target_id}.jsonl"
        ));
        let target_path = tmp.path().join(format!(
            "2026/05/08/rollout-2026-05-08T01-02-04-000000Z-{target_id}.jsonl"
        ));
        write_rollout(&old_path, target_id, "previous-provider");
        write_rollout(&target_path, target_id, "code-tabs-proxy-session-spawn");

        let criteria = RolloutAttributionCriteria {
            expected_codex_session_id: Some(target_id.into()),
            expected_model_provider: Some("code-tabs-proxy-session-spawn".into()),
        };
        let claimed = HashMap::new();
        assert_eq!(
            find_matching_rollout(tmp.path(), &criteria, &claimed),
            Some(target_path)
        );
    }

    #[test]
    fn codex_id_from_rollout_filename_extracts_uuid_suffix() {
        let path = Path::new(
            "sessions/2026/05/05/rollout-2026-05-05T01-02-03-000000Z-019a9656-691d-7ff3-890e-3e6678ed46d8.jsonl",
        );
        assert_eq!(
            codex_id_from_rollout_filename(path).as_deref(),
            Some("019a9656-691d-7ff3-890e-3e6678ed46d8")
        );
    }
}
