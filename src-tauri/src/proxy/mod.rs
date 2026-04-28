//! Slim prompt-rewrite proxy.
//!
// [SP-01] Slim proxy: prompt rewrite + traffic logging only; Anthropic
// and OpenAI are forwarded unchanged except for rule application on the
// provider-native prompt field.
//! What this module is: a localhost HTTP forwarder for Claude Code's
//! `POST /v1/messages` traffic and Codex's OpenAI Responses traffic. It
//! applies user-defined regex rules to Claude's `system` field or
//! OpenAI's `instructions` field (PromptsTab) before forwarding to the
//! original provider, and optionally tees request/response to a
//! per-session `traffic.jsonl`. That's it.
//!
//! What it isn't (and used to be): an Anthropic↔OpenAI translator, a
//! provider router, an OAuth client, a compression engine. All of
//! that lived in `proxy/codex/` and `proxy/compress/` and is gone.

use std::borrow::Cow;
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use tauri::{Emitter, State};

use crate::observability::{
    record_backend_event, record_backend_perf_end, record_backend_perf_fail,
    record_backend_perf_start,
};
use crate::session::types::SystemPromptRule;

// ── Proxy state ──────────────────────────────────────────────────────

#[derive(Clone, Default)]
struct CompiledRules {
    rules: Vec<CompiledRule>,
    set: Option<regex::RegexSet>,
}

#[derive(Clone)]
struct CompiledRule {
    id: String,
    replacement: String,
    regex: regex::Regex,
}

impl CompiledRules {
    fn compile(rules: &[SystemPromptRule]) -> Result<Self, String> {
        let mut compiled = Vec::new();
        let mut patterns = Vec::new();
        for rule in rules {
            if !rule.enabled || rule.pattern.is_empty() {
                continue;
            }
            let pattern = compile_pattern(rule);
            let regex = regex::Regex::new(&pattern)
                .map_err(|e| format!("Invalid regex '{}': {}", rule.pattern, e))?;
            patterns.push(pattern);
            compiled.push(CompiledRule {
                id: rule.id.clone(),
                replacement: rule.replacement.clone(),
                regex,
            });
        }
        let set = if patterns.is_empty() {
            None
        } else {
            Some(regex::RegexSet::new(patterns).map_err(|e| format!("Invalid regex set: {e}"))?)
        };
        Ok(Self {
            rules: compiled,
            set,
        })
    }

    fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    fn matches(&self, text: &str) -> bool {
        self.set.as_ref().map_or(false, |set| set.is_match(text))
    }
}

fn compile_pattern(rule: &SystemPromptRule) -> String {
    let inline_flags: String = rule.flags.chars().filter(|c| *c != 'g').collect();
    if inline_flags.is_empty() {
        rule.pattern.clone()
    } else {
        format!("(?{}){}", inline_flags, rule.pattern)
    }
}

#[derive(Default)]
struct RuleStore {
    compiled: CompiledRules,
}

struct ProxyLifecycle {
    port: Option<u16>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    default_client: reqwest::Client,
}

impl ProxyLifecycle {
    fn new() -> Self {
        Self {
            port: None,
            shutdown_tx: None,
            default_client: build_plain_client(),
        }
    }
}

#[derive(Default)]
struct TrafficLogs {
    files: HashMap<String, std::io::BufWriter<std::fs::File>>,
    paths: HashMap<String, std::path::PathBuf>,
}

#[derive(Clone)]
pub struct ProxyState {
    lifecycle: Arc<Mutex<ProxyLifecycle>>,
    rules: Arc<RwLock<RuleStore>>,
    traffic_logs: Arc<Mutex<TrafficLogs>>,
    rule_match_counts: Arc<Mutex<HashMap<String, u64>>>,
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            lifecycle: Arc::new(Mutex::new(ProxyLifecycle::new())),
            rules: Arc::new(RwLock::new(RuleStore::default())),
            traffic_logs: Arc::new(Mutex::new(TrafficLogs::default())),
            rule_match_counts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn port(&self) -> Option<u16> {
        self.lifecycle.lock().ok().and_then(|s| s.port)
    }

    pub fn stop_and_flush(&self) {
        if let Ok(mut logs) = self.traffic_logs.lock() {
            for writer in logs.files.values_mut() {
                use std::io::Write;
                let _ = writer.flush();
            }
            logs.files.clear();
            logs.paths.clear();
        }
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            if let Some(tx) = lifecycle.shutdown_tx.take() {
                let _ = tx.send(());
            }
            lifecycle.port = None;
        }
    }

    fn default_client(&self) -> Option<reqwest::Client> {
        self.lifecycle.lock().ok().map(|s| s.default_client.clone())
    }

    fn compiled_rules(&self) -> CompiledRules {
        self.rules
            .read()
            .map(|s| s.compiled.clone())
            .unwrap_or_default()
    }

    fn is_traffic_logging(&self, session_id: &str) -> bool {
        self.traffic_logs
            .lock()
            .map(|logs| logs.files.contains_key(session_id))
            .unwrap_or(false)
    }

    fn record_rule_matches(&self, matched_ids: &[String]) -> Option<HashMap<String, u64>> {
        let mut counts = self.rule_match_counts.lock().ok()?;
        for id in matched_ids {
            *counts.entry(id.clone()).or_insert(0) += 1;
        }
        Some(counts.clone())
    }
}

fn build_plain_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(180))
        .pool_idle_timeout(Duration::from_secs(90))
        .no_gzip()
        .no_brotli()
        .no_zstd()
        .no_deflate()
        .build()
        .expect("plain reqwest client must build")
}

// ── Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_api_proxy(
    proxy_state: State<'_, ProxyState>,
    app: tauri::AppHandle,
) -> Result<u16, String> {
    let proxy_state = proxy_state.inner().clone();
    let span_start = std::time::Instant::now();
    let span_data = serde_json::json!({});
    record_backend_perf_start(
        &app,
        "proxy",
        None,
        "proxy.start_api_proxy",
        span_data.clone(),
    );

    let result: Result<u16, String> = async {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Proxy bind failed: {e}"))?;
        let port = listener.local_addr().map_err(|e| format!("{e}"))?.port();

        let default_client = build_plain_client();
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

        {
            let mut lifecycle = proxy_state.lifecycle.lock().map_err(|e| e.to_string())?;
            lifecycle.port = Some(port);
            lifecycle.shutdown_tx = Some(shutdown_tx);
            lifecycle.default_client = default_client.clone();
        }

        record_backend_event(
            &app,
            "LOG",
            "proxy",
            None,
            "proxy.started",
            "API proxy started",
            serde_json::json!({ "port": port }),
        );

        let state = proxy_state.clone();
        let app_for_loop = app.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    result = listener.accept() => {
                        match result {
                            Ok((stream, addr)) => {
                                record_backend_event(
                                    &app_for_loop,
                                    "DEBUG",
                                    "proxy",
                                    None,
                                    "proxy.connection_accepted",
                                    "Accepted proxy client connection",
                                    serde_json::json!({ "remoteAddr": addr.to_string() }),
                                );
                                let default_client = match state.default_client() {
                                    Some(client) => client,
                                    None => continue,
                                };
                                let rules = state.compiled_rules();
                                let a = app_for_loop.clone();
                                let st = state.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = handle_connection(stream, default_client, rules, a, st).await {
                                        log::debug!("proxy connection error: {e}");
                                    }
                                });
                            }
                            Err(e) => {
                                log::warn!("proxy accept error: {e}");
                                record_backend_event(
                                    &app_for_loop,
                                    "WARN",
                                    "proxy",
                                    None,
                                    "proxy.accept_failed",
                                    "Proxy accept failed",
                                    serde_json::json!({ "error": e.to_string() }),
                                );
                                break;
                            }
                        }
                    }
                    _ = &mut shutdown_rx => {
                        record_backend_event(
                            &app_for_loop,
                            "LOG",
                            "proxy",
                            None,
                            "proxy.shutdown_requested",
                            "Proxy shutdown requested",
                            serde_json::json!({}),
                        );
                        break;
                    }
                }
            }
        });

        Ok(port)
    }
    .await;

    match result {
        Ok(port) => {
            record_backend_perf_end(
                &app,
                "proxy",
                None,
                "proxy.start_api_proxy",
                span_start,
                250,
                span_data,
                serde_json::json!({ "port": port }),
            );
            Ok(port)
        }
        Err(err) => {
            record_backend_perf_fail(
                &app,
                "proxy",
                None,
                "proxy.start_api_proxy",
                span_start,
                span_data,
                serde_json::json!({}),
                &err,
            );
            Err(err)
        }
    }
}

#[tauri::command]
pub fn update_system_prompt_rules(
    rules: Vec<SystemPromptRule>,
    proxy_state: State<'_, ProxyState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let span_start = std::time::Instant::now();
    let span_data = serde_json::json!({
        "ruleCount": rules.len(),
        "enabledRuleCount": rules.iter().filter(|rule| rule.enabled).count(),
    });
    record_backend_perf_start(
        &app,
        "proxy",
        None,
        "proxy.update_system_prompt_rules",
        span_data.clone(),
    );
    let result = (|| -> Result<(), String> {
        let compiled = CompiledRules::compile(&rules)?;
        let active_ids: std::collections::HashSet<String> =
            rules.iter().map(|r| r.id.clone()).collect();
        let mut counts = proxy_state
            .rule_match_counts
            .lock()
            .map_err(|e| e.to_string())?;
        counts.retain(|id, _| active_ids.contains(id));
        drop(counts);

        let mut store = proxy_state.rules.write().map_err(|e| e.to_string())?;
        store.compiled = compiled;
        Ok(())
    })();
    match result {
        Ok(()) => {
            record_backend_event(
                &app,
                "LOG",
                "proxy",
                None,
                "proxy.system_prompt_rules_updated",
                "Updated system prompt rewrite rules",
                serde_json::json!({}),
            );
            record_backend_perf_end(
                &app,
                "proxy",
                None,
                "proxy.update_system_prompt_rules",
                span_start,
                250,
                span_data,
                serde_json::json!({}),
            );
            Ok(())
        }
        Err(err) => {
            record_backend_perf_fail(
                &app,
                "proxy",
                None,
                "proxy.update_system_prompt_rules",
                span_start,
                span_data,
                serde_json::json!({}),
                &err,
            );
            Err(err)
        }
    }
}

// [CM-32] Per-session rule match counters: HashMap<ruleId, count>;
// incremented on each proxy match, emitted to the frontend, and exposed
// through get_rule_match_counts for initial state.
#[tauri::command]
pub fn get_rule_match_counts(
    proxy_state: State<'_, ProxyState>,
) -> Result<HashMap<String, u64>, String> {
    let counts = proxy_state
        .rule_match_counts
        .lock()
        .map_err(|e| e.to_string())?;
    Ok(counts.clone())
}

#[tauri::command]
pub fn start_traffic_log(
    session_id: String,
    proxy_state: State<'_, ProxyState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let span_start = std::time::Instant::now();
    let span_data = serde_json::json!({ "sessionId": session_id });
    record_backend_perf_start(
        &app,
        "traffic",
        Some(&session_id),
        "traffic.start_log",
        span_data.clone(),
    );
    let result = (|| -> Result<String, String> {
        let dir = crate::commands::get_session_data_dir(&session_id)?;
        let path = dir.join("traffic.jsonl");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("Failed to create traffic log: {}", e))?;
        let writer = std::io::BufWriter::new(file);
        let mut logs = proxy_state.traffic_logs.lock().map_err(|e| e.to_string())?;
        logs.files.insert(session_id.clone(), writer);
        logs.paths.insert(session_id.clone(), path.clone());
        Ok(path.to_string_lossy().to_string())
    })();
    match result {
        Ok(path) => {
            record_backend_event(
                &app,
                "LOG",
                "traffic",
                Some(&session_id),
                "traffic.log_started",
                "Started traffic log",
                serde_json::json!({ "path": path }),
            );
            record_backend_perf_end(
                &app,
                "traffic",
                Some(&session_id),
                "traffic.start_log",
                span_start,
                250,
                span_data,
                serde_json::json!({ "path": path }),
            );
            Ok(path)
        }
        Err(err) => {
            record_backend_perf_fail(
                &app,
                "traffic",
                Some(&session_id),
                "traffic.start_log",
                span_start,
                span_data,
                serde_json::json!({}),
                &err,
            );
            Err(err)
        }
    }
}

#[tauri::command]
pub fn stop_traffic_log(
    session_id: String,
    proxy_state: State<'_, ProxyState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let span_start = std::time::Instant::now();
    let span_data = serde_json::json!({ "sessionId": session_id });
    record_backend_perf_start(
        &app,
        "traffic",
        Some(&session_id),
        "traffic.stop_log",
        span_data.clone(),
    );
    let result = (|| -> Result<(), String> {
        let mut logs = proxy_state.traffic_logs.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut writer) = logs.files.get_mut(&session_id) {
            use std::io::Write;
            let _ = writer.flush();
        }
        logs.files.remove(&session_id);
        logs.paths.remove(&session_id);
        Ok(())
    })();
    match result {
        Ok(()) => {
            record_backend_event(
                &app,
                "LOG",
                "traffic",
                Some(&session_id),
                "traffic.log_stopped",
                "Stopped traffic log",
                serde_json::json!({}),
            );
            record_backend_perf_end(
                &app,
                "traffic",
                Some(&session_id),
                "traffic.stop_log",
                span_start,
                250,
                span_data,
                serde_json::json!({}),
            );
            Ok(())
        }
        Err(err) => {
            record_backend_perf_fail(
                &app,
                "traffic",
                Some(&session_id),
                "traffic.stop_log",
                span_start,
                span_data,
                serde_json::json!({}),
                &err,
            );
            Err(err)
        }
    }
}

// ── Connection handling ─────────────────────────────────────────────

const ANTHROPIC_UPSTREAM_BASE_URL: &str = "https://api.anthropic.com";
const OPENAI_UPSTREAM_BASE_URL: &str = "https://api.openai.com";
const CHATGPT_UPSTREAM_BASE_URL: &str = "https://chatgpt.com";
const LARGE_REWRITE_BODY_BYTES: usize = 64 * 1024;

// [SP-02] Per-request upstream resolver: anthropic / openai / chatgpt routing + path matchers + Responses API instructions rewrite (Codex/OpenAI Responses analog of Claude system field). ChatGpt covers the chatgpt.com/backend-api/codex endpoints used by Codex sessions authenticated via ChatGPT subscription; OpenAi covers api.openai.com/v1 used by API-key-authenticated sessions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UpstreamKind {
    Anthropic,
    OpenAi,
    ChatGpt,
}

impl UpstreamKind {
    fn base_url(self) -> &'static str {
        match self {
            UpstreamKind::Anthropic => ANTHROPIC_UPSTREAM_BASE_URL,
            UpstreamKind::OpenAi => OPENAI_UPSTREAM_BASE_URL,
            UpstreamKind::ChatGpt => CHATGPT_UPSTREAM_BASE_URL,
        }
    }

    fn label(self) -> &'static str {
        match self {
            UpstreamKind::Anthropic => "anthropic",
            UpstreamKind::OpenAi => "openai",
            UpstreamKind::ChatGpt => "chatgpt",
        }
    }
}

fn path_matches_endpoint(path: &str, endpoint: &str) -> bool {
    path == endpoint
        || path.strip_prefix(endpoint).map_or(false, |suffix| {
            suffix.starts_with('?') || suffix.starts_with('/')
        })
}

fn is_anthropic_endpoint(path: &str) -> bool {
    path_matches_endpoint(path, "/v1/messages") || path_matches_endpoint(path, "/v1/complete")
}

fn is_openai_responses_endpoint(path: &str) -> bool {
    path_matches_endpoint(path, "/v1/responses")
}

// Match exactly the Codex Responses endpoint on chatgpt.com — NOT a broad
// `/backend-api/codex/` prefix. Codex hits adjacent endpoints there
// (account/usage/etc.) that should pass through unrewritten.
fn is_chatgpt_responses_endpoint(path: &str) -> bool {
    path_matches_endpoint(path, "/backend-api/codex/responses")
}

fn is_chatgpt_codex_path(path: &str) -> bool {
    path.starts_with("/backend-api/codex/") || path == "/backend-api/codex"
}

fn is_openai_v1_path(path: &str) -> bool {
    path.starts_with("/v1/")
}

fn resolve_upstream(path: &str) -> Option<UpstreamKind> {
    const ROUTES: &[(fn(&str) -> bool, UpstreamKind)] = &[
        (is_anthropic_endpoint, UpstreamKind::Anthropic),
        (is_chatgpt_codex_path, UpstreamKind::ChatGpt),
        (is_openai_v1_path, UpstreamKind::OpenAi),
    ];
    ROUTES
        .iter()
        .find_map(|(matcher, upstream)| matcher(path).then_some(*upstream))
}

async fn handle_connection(
    mut stream: tokio::net::TcpStream,
    default_client: reqwest::Client,
    rules: CompiledRules,
    app: tauri::AppHandle,
    proxy_state: ProxyState,
) -> std::io::Result<()> {
    // Read the request (headers + body) up to 50 MiB.
    let mut buf = Vec::with_capacity(8192);
    loop {
        let mut tmp = [0u8; 8192];
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);

        if let Some(hend) = find_header_end(&buf) {
            if let Some(cl) = extract_content_length_bytes(&buf[..hend]) {
                if buf.len() >= hend + cl {
                    break;
                }
            } else {
                break;
            }
        }

        if buf.len() > 50 * 1024 * 1024 {
            send_error(&mut stream, 413, "Request too large").await;
            return Ok(());
        }
    }

    let Some(header_end) = find_header_end(&buf) else {
        send_error(&mut stream, 400, "Bad request").await;
        return Ok(());
    };

    let (method, raw_path, headers, body) = match parse_request(&buf, header_end) {
        Some(r) => r,
        None => {
            send_error(&mut stream, 400, "Bad request").await;
            return Ok(());
        }
    };

    // /s/{id}/... session-scoped prefix is stripped for the upstream call
    // but kept around for traffic-log lookup.
    let (session_id, path) = extract_session_id(&raw_path);

    let should_log = session_id.map_or(false, |id| proxy_state.is_traffic_logging(id));

    let model = extract_model(&body);

    let Some(upstream) = resolve_upstream(path) else {
        record_backend_event(
            &app,
            "WARN",
            "proxy",
            session_id,
            "proxy.route_not_found",
            "Proxy route not found",
            serde_json::json!({
                "method": method,
                "rawPath": raw_path.as_str(),
                "path": path,
                "sessionScoped": session_id.is_some(),
            }),
        );
        send_error(&mut stream, 404, "No proxy route for request path").await;
        return Ok(());
    };
    let rewritable_prompt_endpoint = match upstream {
        UpstreamKind::Anthropic => is_anthropic_endpoint(path),
        UpstreamKind::OpenAi => is_openai_responses_endpoint(path),
        UpstreamKind::ChatGpt => is_chatgpt_responses_endpoint(path),
    };

    // Apply prompt rewrite rules to the provider-native prompt field:
    // Claude/Anthropic => `system`, OpenAI / ChatGPT Responses => `instructions`
    // (same wire shape on both endpoints).
    let (final_body, matched_ids) = if rules.is_empty() || !rewritable_prompt_endpoint {
        (body, Vec::new())
    } else if body.len() > LARGE_REWRITE_BODY_BYTES {
        let rules = rules.clone();
        match tokio::task::spawn_blocking(move || {
            rewrite_body_for_upstream(&body, upstream, &rules)
        })
        .await
        {
            Ok(result) => result,
            Err(e) => {
                send_error(
                    &mut stream,
                    500,
                    &format!("Prompt rewrite task failed: {e}"),
                )
                .await;
                return Ok(());
            }
        }
    } else {
        rewrite_body_for_upstream(&body, upstream, &rules)
    };
    if !matched_ids.is_empty() {
        if let Some(counts) = proxy_state.record_rule_matches(&matched_ids) {
            let _ = app.emit("rule_match_counts", counts);
        }
    }

    record_backend_event(
        &app,
        "DEBUG",
        "proxy",
        session_id,
        "proxy.route_resolved",
        "Resolved proxy route",
        serde_json::json!({
            "method": method,
            "rawPath": raw_path.as_str(),
            "path": path,
            "upstream": upstream.label(),
            "sessionScoped": session_id.is_some(),
            "requestModel": model,
            "promptRulesEligible": rewritable_prompt_endpoint,
            "promptRulesApplied": !matched_ids.is_empty(),
            "shouldLogTraffic": should_log,
        }),
    );

    // Build upstream request. This is routing only, not provider translation:
    // headers and request bodies otherwise pass through unchanged.
    let url = format!("{}{}", upstream.base_url().trim_end_matches('/'), path);
    let http_method =
        reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::POST);
    let mut req = default_client.request(http_method, &url);
    for (k, v) in &headers {
        let lower = k.to_lowercase();
        if lower == "host" || lower == "content-length" || lower == "accept-encoding" {
            continue;
        }
        req = req.header(k.as_str(), v.as_str());
    }

    let final_body_for_log = if should_log {
        Some(final_body.clone())
    } else {
        None
    };
    let req_start = std::time::Instant::now();
    let req_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    let log_method = method.clone();
    let log_path = path.to_string();
    let log_session_id = session_id.map(str::to_string);
    let log_model = model.clone();
    let route_span_data = serde_json::json!({
        "method": log_method,
        "path": log_path,
        "model": log_model,
        "upstream": upstream.label(),
        "shouldLogTraffic": should_log,
    });
    record_backend_perf_start(
        &app,
        "proxy",
        log_session_id.as_deref(),
        "proxy.route_request",
        route_span_data.clone(),
    );

    req = req.body(final_body);

    let mut resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let error_message = e.to_string();
            if should_log {
                write_traffic_entry(
                    &proxy_state,
                    log_session_id.as_deref(),
                    req_ts,
                    req_start,
                    &log_method,
                    &log_path,
                    &log_model,
                    &final_body_for_log,
                    502,
                    None,
                    b"",
                );
            }
            record_backend_perf_fail(
                &app,
                "proxy",
                log_session_id.as_deref(),
                "proxy.route_request",
                req_start,
                route_span_data.clone(),
                serde_json::json!({}),
                &error_message,
            );
            record_backend_event(
                &app,
                "WARN",
                "proxy",
                log_session_id.as_deref(),
                "proxy.request_failed",
                "Upstream proxy request failed",
                serde_json::json!({
                    "durationMs": req_start.elapsed().as_millis() as u64,
                    "method": log_method,
                    "path": log_path,
                    "upstream": upstream.label(),
                    "model": log_model,
                    "error": error_message,
                }),
            );
            send_error(&mut stream, 502, &format!("Upstream error: {e}")).await;
            return Ok(());
        }
    };

    let status_code = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("Unknown");
    let response_content_encoding = resp
        .headers()
        .get("content-encoding")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    // [WX-01] Cloudflare's edge tags every Anthropic / OpenAI response with
    // `cf-ipcountry`. Forward the value to the weather module for ambient-
    // viz weather. Fire-and-forget; never blocks the response stream.
    if let Some(cc) = resp
        .headers()
        .get("cf-ipcountry")
        .and_then(|v| v.to_str().ok())
    {
        crate::weather::set_country(cc);
    }

    let mut resp_hdrs = format!("HTTP/1.1 {status_code} {status_text}\r\n");
    for (k, v) in resp.headers() {
        let lower = k.as_str().to_lowercase();
        if lower == "transfer-encoding" || lower == "content-length" {
            continue;
        }
        let val = v.to_str().unwrap_or("");
        resp_hdrs.push_str(&format!("{k}: {val}\r\n"));
    }
    resp_hdrs.push_str("Connection: close\r\n\r\n");
    stream.write_all(resp_hdrs.as_bytes()).await?;

    let mut resp_buf: Option<Vec<u8>> = if should_log {
        Some(Vec::with_capacity(8192))
    } else {
        None
    };
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?
    {
        stream.write_all(&chunk).await?;
        stream.flush().await?;
        if let Some(ref mut buf) = resp_buf {
            buf.extend_from_slice(&chunk);
        }
    }

    if let Some(resp_bytes) = resp_buf {
        write_traffic_entry(
            &proxy_state,
            log_session_id.as_deref(),
            req_ts,
            req_start,
            &log_method,
            &log_path,
            &log_model,
            &final_body_for_log,
            status_code,
            response_content_encoding.as_deref(),
            &resp_bytes,
        );
    }

    record_backend_perf_end(
        &app,
        "proxy",
        log_session_id.as_deref(),
        "proxy.route_request",
        req_start,
        1000,
        route_span_data,
        serde_json::json!({ "status": status_code }),
    );
    record_backend_event(
        &app,
        "LOG",
        "proxy",
        log_session_id.as_deref(),
        "proxy.request_completed",
        "Proxy request completed",
        serde_json::json!({
            "durationMs": req_start.elapsed().as_millis() as u64,
            "method": log_method,
            "path": log_path,
            "upstream": upstream.label(),
            "model": log_model,
            "status": status_code,
        }),
    );

    Ok(())
}

// ── Traffic log helpers ─────────────────────────────────────────────

fn read_all<R: Read>(mut reader: R) -> Option<Vec<u8>> {
    let mut decoded = Vec::new();
    reader.read_to_end(&mut decoded).ok()?;
    Some(decoded)
}

fn decompress_gzip(bytes: &[u8]) -> Option<Vec<u8>> {
    read_all(flate2::read::GzDecoder::new(bytes))
}

fn decompress_deflate(bytes: &[u8]) -> Option<Vec<u8>> {
    read_all(flate2::read::ZlibDecoder::new(bytes))
        .or_else(|| read_all(flate2::read::DeflateDecoder::new(bytes)))
}

fn decompress_response(content_encoding: Option<&str>, bytes: &[u8]) -> String {
    let Some(content_encoding) = content_encoding
        .map(str::trim)
        .filter(|encoding| !encoding.is_empty())
    else {
        if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
            if let Some(decoded) = decompress_gzip(bytes) {
                return String::from_utf8_lossy(&decoded).into_owned();
            }
        }
        return String::from_utf8_lossy(bytes).into_owned();
    };

    let mut decoded = bytes.to_vec();
    for encoding in content_encoding.split(',').map(|s| s.trim()).rev() {
        if encoding.eq_ignore_ascii_case("identity") || encoding.is_empty() {
            continue;
        } else if encoding.eq_ignore_ascii_case("gzip") || encoding.eq_ignore_ascii_case("x-gzip") {
            let Some(next) = decompress_gzip(&decoded) else {
                return format!(
                    "(gzip body, failed to decode; {} encoded bytes)",
                    bytes.len()
                );
            };
            decoded = next;
        } else if encoding.eq_ignore_ascii_case("deflate") {
            let Some(next) = decompress_deflate(&decoded) else {
                return format!(
                    "(deflate body, failed to decode; {} encoded bytes)",
                    bytes.len()
                );
            };
            decoded = next;
        } else if encoding.eq_ignore_ascii_case("br")
            || encoding.eq_ignore_ascii_case("brotli")
            || encoding.eq_ignore_ascii_case("zstd")
            || encoding.eq_ignore_ascii_case("zstandard")
        {
            return format!(
                "({encoding} body, not decoded; {} encoded bytes)",
                bytes.len()
            );
        } else {
            return format!(
                "({encoding} body, unsupported content-encoding; {} encoded bytes)",
                bytes.len()
            );
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn build_traffic_entry_json(
    req_ts: f64,
    dur_ms: u64,
    sid: &str,
    method: &str,
    path: &str,
    model: &Option<String>,
    req_body: &Option<Vec<u8>>,
    status: u16,
    resp_content_encoding: Option<&str>,
    resp_bytes: &[u8],
) -> Value {
    let req_str = req_body
        .as_ref()
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .unwrap_or_default();
    let resp_str = decompress_response(resp_content_encoding, resp_bytes);
    let req_len = req_body.as_ref().map(|b| b.len()).unwrap_or(0);

    serde_json::json!({
        "ts": req_ts,
        "dur_ms": dur_ms,
        "session_id": sid,
        "method": method,
        "path": path,
        "model": model.as_deref().unwrap_or("(none)"),
        "req_len": req_len,
        "req": req_str,
        "status": status,
        "resp_len": resp_bytes.len(),
        "resp": resp_str,
    })
}

pub(crate) fn write_traffic_entry(
    proxy_state: &ProxyState,
    session_id: Option<&str>,
    req_ts: f64,
    req_start: std::time::Instant,
    method: &str,
    path: &str,
    model: &Option<String>,
    req_body: &Option<Vec<u8>>,
    status: u16,
    resp_content_encoding: Option<&str>,
    resp_bytes: &[u8],
) {
    let sid = match session_id {
        Some(id) => id,
        None => return,
    };
    let dur_ms = req_start.elapsed().as_millis() as u64;
    let line = build_traffic_entry_json(
        req_ts,
        dur_ms,
        sid,
        method,
        path,
        model,
        req_body,
        status,
        resp_content_encoding,
        resp_bytes,
    );

    if let Ok(mut logs) = proxy_state.traffic_logs.lock() {
        if let Some(ref mut writer) = logs.files.get_mut(sid) {
            use std::io::Write;
            let _ = writeln!(writer, "{}", line);
        }
    }
}

// ── System prompt rule application ──────────────────────────────────

fn rewrite_body_for_upstream(
    body: &[u8],
    upstream: UpstreamKind,
    rules: &CompiledRules,
) -> (Vec<u8>, Vec<String>) {
    match upstream {
        UpstreamKind::Anthropic => rewrite_system_prompt_in_body(body, rules),
        UpstreamKind::OpenAi | UpstreamKind::ChatGpt => {
            rewrite_openai_instructions_in_body(body, rules)
        }
    }
}

fn rewrite_system_prompt_in_body(body: &[u8], rules: &CompiledRules) -> (Vec<u8>, Vec<String>) {
    if rules.is_empty() {
        return (body.to_vec(), Vec::new());
    }
    let mut json = match serde_json::from_slice::<serde_json::Value>(body) {
        Ok(j) => j,
        Err(_) => return (body.to_vec(), Vec::new()),
    };
    let system = match json.get_mut("system") {
        Some(s) => s,
        None => {
            return (
                serde_json::to_vec(&json).unwrap_or_else(|_| body.to_vec()),
                Vec::new(),
            );
        }
    };
    let mut matched: Vec<String> = Vec::new();
    apply_rules_to_system_value(system, rules, &mut matched);
    (
        serde_json::to_vec(&json).unwrap_or_else(|_| body.to_vec()),
        matched,
    )
}

fn rewrite_openai_instructions_in_body(
    body: &[u8],
    rules: &CompiledRules,
) -> (Vec<u8>, Vec<String>) {
    if rules.is_empty() {
        return (body.to_vec(), Vec::new());
    }
    let mut json = match serde_json::from_slice::<serde_json::Value>(body) {
        Ok(j) => j,
        Err(_) => return (body.to_vec(), Vec::new()),
    };
    let instructions = match json.get_mut("instructions") {
        Some(serde_json::Value::String(s)) => s,
        _ => return (body.to_vec(), Vec::new()),
    };
    let mut matched: Vec<String> = Vec::new();
    *instructions = apply_rules_to_text(instructions, rules, &mut matched);
    (
        serde_json::to_vec(&json).unwrap_or_else(|_| body.to_vec()),
        matched,
    )
}

fn apply_rules_to_system_value(
    system: &mut serde_json::Value,
    rules: &CompiledRules,
    matched: &mut Vec<String>,
) {
    match system {
        serde_json::Value::String(s) => {
            *s = apply_rules_to_text(s, rules, matched);
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                if let Some(obj) = item.as_object_mut() {
                    if obj.get("type").and_then(|v| v.as_str()) == Some("text") {
                        if let Some(text_val) = obj.get_mut("text") {
                            if let serde_json::Value::String(ref mut s) = text_val {
                                *s = apply_rules_to_text(s, rules, matched);
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

fn apply_rules_to_text(text: &str, rules: &CompiledRules, matched: &mut Vec<String>) -> String {
    if text.is_empty() || !rules.matches(text) {
        return text.to_string();
    }

    let mut result = Cow::Borrowed(text);
    for rule in &rules.rules {
        let replaced = rule
            .regex
            .replace_all(result.as_ref(), rule.replacement.as_str());
        if let Cow::Owned(next) = replaced {
            if !matched.contains(&rule.id) {
                matched.push(rule.id.clone());
            }
            result = Cow::Owned(next);
        }
    }
    result.into_owned()
}

// ── HTTP parsing helpers ────────────────────────────────────────────

fn extract_session_id(path: &str) -> (Option<&str>, &str) {
    if let Some(rest) = path.strip_prefix("/s/") {
        if let Some(slash_pos) = rest.find('/') {
            let id = &rest[..slash_pos];
            let remaining = &rest[slash_pos..];
            return (Some(id), remaining);
        }
    }
    (None, path)
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    memchr::memmem::find(buf, b"\r\n\r\n").map(|i| i + 4)
}

fn trim_ascii(bytes: &[u8]) -> &[u8] {
    let start = bytes
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .map_or(start, |idx| idx + 1);
    &bytes[start..end]
}

fn split_once_byte(bytes: &[u8], needle: u8) -> Option<(&[u8], &[u8])> {
    let pos = memchr::memchr(needle, bytes)?;
    Some((&bytes[..pos], &bytes[pos + 1..]))
}

fn parse_usize_ascii(bytes: &[u8]) -> Option<usize> {
    let mut value = 0usize;
    for b in bytes {
        if !b.is_ascii_digit() {
            return None;
        }
        value = value.checked_mul(10)?.checked_add((b - b'0') as usize)?;
    }
    Some(value)
}

fn extract_content_length_bytes(headers: &[u8]) -> Option<usize> {
    for line in headers.split(|b| *b == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let Some((name, value)) = split_once_byte(line, b':') else {
            continue;
        };
        if trim_ascii(name).eq_ignore_ascii_case(b"content-length") {
            return parse_usize_ascii(trim_ascii(value));
        }
    }
    None
}

#[cfg(test)]
fn extract_content_length(headers: &str) -> Option<usize> {
    extract_content_length_bytes(headers.as_bytes())
}

fn parse_request(
    buf: &[u8],
    header_end: usize,
) -> Option<(String, String, Vec<(String, String)>, Vec<u8>)> {
    let hdr = String::from_utf8_lossy(&buf[..header_end - 4]);
    let mut lines = hdr.lines();
    let req_line = lines.next()?;
    let mut parts = req_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = Vec::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    Some((method, path, headers, buf[header_end..].to_vec()))
}

fn extract_model(body: &[u8]) -> Option<String> {
    let json: serde_json::Value = serde_json::from_slice(body).ok()?;
    json.get("model")?.as_str().map(|s| s.to_string())
}

async fn send_error(stream: &mut tokio::net::TcpStream, status: u16, msg: &str) {
    let body = serde_json::json!({
        "type": "error",
        "error": { "type": "proxy_error", "message": msg }
    })
    .to_string();
    let reason = match status {
        400 => "Bad Request",
        404 => "Not Found",
        413 => "Too Large",
        500 => "Internal Error",
        502 => "Bad Gateway",
        _ => "Error",
    };
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len(),
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.flush().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_rule(id: &str, pattern: &str, replacement: &str, enabled: bool) -> SystemPromptRule {
        SystemPromptRule {
            id: id.into(),
            name: id.into(),
            pattern: pattern.into(),
            flags: String::new(),
            replacement: replacement.into(),
            enabled,
        }
    }

    fn compile_rules(rules: Vec<SystemPromptRule>) -> CompiledRules {
        CompiledRules::compile(&rules).unwrap()
    }

    #[test]
    fn test_extract_model() {
        let body = br#"{"model":"claude-sonnet-4-5","messages":[]}"#;
        assert_eq!(extract_model(body), Some("claude-sonnet-4-5".into()));
    }

    #[test]
    fn test_extract_model_missing() {
        let body = br#"{"messages":[]}"#;
        assert_eq!(extract_model(body), None);
    }

    #[test]
    fn test_find_header_end() {
        let buf = b"GET / HTTP/1.1\r\nHost: x\r\n\r\nbody";
        assert_eq!(find_header_end(buf), Some(27));
    }

    #[test]
    fn test_content_length() {
        let h = "POST / HTTP/1.1\r\nContent-Length: 42\r\n";
        assert_eq!(extract_content_length(h), Some(42));
    }

    #[test]
    fn test_extract_session_id_present() {
        let (sid, p) = extract_session_id("/s/abc123/v1/messages");
        assert_eq!(sid, Some("abc123"));
        assert_eq!(p, "/v1/messages");
    }

    #[test]
    fn test_extract_session_id_absent() {
        let (sid, p) = extract_session_id("/v1/messages");
        assert_eq!(sid, None);
        assert_eq!(p, "/v1/messages");
    }

    #[test]
    fn test_rewrite_system_prompt_string() {
        let body = br#"{"model":"x","system":"hello world","messages":[]}"#;
        let rules = compile_rules(vec![make_rule("r1", "hello", "goodbye", true)]);
        let (out, matched) = rewrite_system_prompt_in_body(body, &rules);
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["system"], "goodbye world");
        assert_eq!(matched, vec!["r1".to_string()]);
    }

    #[test]
    fn test_rewrite_system_prompt_array() {
        let body = br#"{"model":"x","system":[{"type":"text","text":"alpha beta"}],"messages":[]}"#;
        let rules = compile_rules(vec![make_rule("r1", "alpha", "ALPHA", true)]);
        let (out, matched) = rewrite_system_prompt_in_body(body, &rules);
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["system"][0]["text"], "ALPHA beta");
        assert_eq!(matched, vec!["r1".to_string()]);
    }

    #[test]
    fn test_rewrite_system_prompt_array_skips_non_text_items() {
        let body =
            br#"{"model":"x","system":[{"type":"image","text":"alpha"},{"type":"text","text":"alpha"}],"messages":[]}"#;
        let rules = compile_rules(vec![make_rule("r1", "alpha", "ALPHA", true)]);
        let (out, matched) = rewrite_system_prompt_in_body(body, &rules);
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["system"][0]["text"], "alpha");
        assert_eq!(v["system"][1]["text"], "ALPHA");
        assert_eq!(matched, vec!["r1".to_string()]);
    }

    #[test]
    fn test_rewrite_system_prompt_disabled_rule_skipped() {
        let body = br#"{"model":"x","system":"hello","messages":[]}"#;
        let rules = compile_rules(vec![make_rule("r1", "hello", "goodbye", false)]);
        let (out, matched) = rewrite_system_prompt_in_body(body, &rules);
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["system"], "hello");
        assert!(matched.is_empty());
    }

    #[test]
    fn test_rewrite_system_prompt_empty_rules() {
        let body = br#"{"model":"x","system":"hello","messages":[]}"#;
        let rules = CompiledRules::default();
        let (out, matched) = rewrite_system_prompt_in_body(body, &rules);
        assert_eq!(out, body);
        assert!(matched.is_empty());
    }

    #[test]
    fn test_rewrite_system_prompt_multiple_rules() {
        let body = br#"{"model":"x","system":"foo bar baz","messages":[]}"#;
        let rules = compile_rules(vec![
            make_rule("r1", "foo", "FOO", true),
            make_rule("r2", "baz", "BAZ", true),
        ]);
        let (out, matched) = rewrite_system_prompt_in_body(body, &rules);
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["system"], "FOO bar BAZ");
        assert_eq!(matched.len(), 2);
        assert!(matched.contains(&"r1".into()));
        assert!(matched.contains(&"r2".into()));
    }

    #[test]
    fn test_rewrite_openai_instructions_prompt() {
        let body = br#"{"model":"gpt-5.2","instructions":"hello world","input":[]}"#;
        let rules = compile_rules(vec![make_rule("r1", "hello", "goodbye", true)]);
        let (out, matched) = rewrite_openai_instructions_in_body(body, &rules);
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["instructions"], "goodbye world");
        assert_eq!(matched, vec!["r1".to_string()]);
    }

    #[test]
    fn test_rewrite_openai_instructions_missing_is_noop() {
        let body = br#"{"model":"gpt-5.2","input":[]}"#;
        let rules = compile_rules(vec![make_rule("r1", "hello", "goodbye", true)]);
        let (out, matched) = rewrite_openai_instructions_in_body(body, &rules);
        assert_eq!(out, body);
        assert!(matched.is_empty());
    }

    #[test]
    fn test_invalid_regex_rejected_at_compile_time() {
        let rule = make_rule("r1", "[", "x", true);
        assert!(CompiledRules::compile(&[rule]).is_err());
    }

    #[test]
    fn test_resolve_upstream_routes_provider_native_endpoints() {
        assert_eq!(
            resolve_upstream("/v1/messages"),
            Some(UpstreamKind::Anthropic)
        );
        assert_eq!(
            resolve_upstream("/v1/messages/count_tokens"),
            Some(UpstreamKind::Anthropic)
        );
        assert_eq!(
            resolve_upstream("/v1/responses"),
            Some(UpstreamKind::OpenAi)
        );
        assert_eq!(resolve_upstream("/v1/models"), Some(UpstreamKind::OpenAi));
        assert_eq!(
            resolve_upstream("/backend-api/codex/responses"),
            Some(UpstreamKind::ChatGpt)
        );
        assert_eq!(
            resolve_upstream("/backend-api/codex/account"),
            Some(UpstreamKind::ChatGpt)
        );
        assert_eq!(resolve_upstream("/v2/messages"), None);
    }

    #[test]
    fn test_path_matches_endpoint_rejects_adjacent_prefixes() {
        assert!(path_matches_endpoint("/v1/messages", "/v1/messages"));
        assert!(path_matches_endpoint(
            "/v1/messages?stream=true",
            "/v1/messages"
        ));
        assert!(path_matches_endpoint(
            "/v1/messages/count_tokens",
            "/v1/messages"
        ));
        assert!(!path_matches_endpoint("/v1/messagesXY", "/v1/messages"));
        assert!(path_matches_endpoint("/v1/messages//", "/v1/messages"));
    }

    #[test]
    fn test_is_chatgpt_responses_endpoint_is_exact_match() {
        assert!(is_chatgpt_responses_endpoint(
            "/backend-api/codex/responses"
        ));
        assert!(is_chatgpt_responses_endpoint(
            "/backend-api/codex/responses?stream=true"
        ));
        assert!(is_chatgpt_responses_endpoint(
            "/backend-api/codex/responses/123"
        ));
        // Non-responses paths under the same prefix must NOT match — they
        // should pass through to chatgpt.com without prompt-rewrite.
        assert!(!is_chatgpt_responses_endpoint("/backend-api/codex/account"));
        assert!(!is_chatgpt_responses_endpoint("/backend-api/codex"));
        assert!(!is_chatgpt_responses_endpoint("/v1/responses"));
    }

    #[test]
    fn test_chatgpt_upstream_rewrites_instructions() {
        // Routing test: confirm a request targeted at the ChatGPT-codex
        // Responses endpoint runs through the same instructions-rewrite
        // path as the api.openai.com Responses endpoint.
        let path = "/backend-api/codex/responses";
        let upstream = resolve_upstream(path).unwrap();
        assert_eq!(upstream, UpstreamKind::ChatGpt);
        let rewritable = match upstream {
            UpstreamKind::Anthropic => is_anthropic_endpoint(path),
            UpstreamKind::OpenAi => is_openai_responses_endpoint(path),
            UpstreamKind::ChatGpt => is_chatgpt_responses_endpoint(path),
        };
        assert!(rewritable);

        let body = br#"{"model":"gpt-5.2","instructions":"hello world","input":[]}"#;
        let rules = compile_rules(vec![make_rule("r1", "hello", "goodbye", true)]);
        let (out, matched) = rewrite_openai_instructions_in_body(body, &rules);
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["instructions"], "goodbye world");
        assert_eq!(matched, vec!["r1".to_string()]);
    }

    #[test]
    fn test_rewrite_large_body_uses_linear_regex_engine() {
        let system = "a".repeat(1024 * 1024);
        let body = serde_json::json!({
            "model": "x",
            "system": system,
            "messages": [],
        })
        .to_string();
        let rules = compile_rules(vec![make_rule("r1", "a{4}", "bbbb", true)]);
        let (out, matched) = rewrite_system_prompt_in_body(body.as_bytes(), &rules);
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["system"].as_str().unwrap().len(), 1024 * 1024);
        assert_eq!(matched, vec!["r1".to_string()]);
    }

    #[test]
    fn test_decompress_response_gzip_by_header() {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(b"{\"ok\":true}").unwrap();
        let bytes = encoder.finish().unwrap();

        assert_eq!(
            decompress_response(Some("gzip"), &bytes),
            "{\"ok\":true}".to_string()
        );
    }

    #[test]
    fn test_decompress_response_reports_unsupported_encoding() {
        let decoded = decompress_response(Some("br"), b"encoded");
        assert!(decoded.contains("not decoded"));
        assert!(decoded.contains("encoded bytes"));
    }

    #[test]
    fn test_build_traffic_entry_basic_shape() {
        let entry = build_traffic_entry_json(
            1234.5,
            42,
            "sid-1",
            "POST",
            "/v1/messages",
            &Some("sonnet".into()),
            &Some(b"{}".to_vec()),
            200,
            None,
            b"hello",
        );
        assert_eq!(entry["session_id"], "sid-1");
        assert_eq!(entry["method"], "POST");
        assert_eq!(entry["model"], "sonnet");
        assert_eq!(entry["status"], 200);
        assert_eq!(entry["resp_len"], 5);
    }
}
