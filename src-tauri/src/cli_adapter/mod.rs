//! CLI adapter abstraction.
//!
//! Both Claude Code and Codex are spawned as PTY children of code-tabs.
//! Their detection, version probing, args building, and launch-option
//! discovery differ; everything else (PTY layer, observability sink,
//! tab UI) is shared. A `CliAdapter` is the single seam that holds the
//! per-CLI specifics.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::session::types::{CliKind, SessionConfig};

pub mod claude;
pub mod codex;

/// Concrete spec the PTY layer needs to launch a session.
///
/// `program` is an absolute path; `args` is the full argv after the
/// program name; `env_overrides` are additional env vars to set or
/// unset (None = unset) on top of the inherited env. The PTY layer
/// already strips `BUN_INSPECT*` / `NODE_OPTIONS` from inherited env
/// for Claude; codex-specific stripping (if any) goes here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// Tuples of (key, Some(value) | None). None means "unset this
    /// inherited env var before exec." Iteration order is preserved
    /// because some hooks (`CLAUDECODE` strip, [PT-03]) are order-
    /// sensitive on Windows.
    pub env_overrides: Vec<(String, Option<String>)>,
    pub cwd: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_proxy_provider_id: Option<String>,
}

/// Detection result. `path` is the resolved binary, `source` describes
/// how we found it (mirrors Claude's `[RC-16]` chain so log output
/// stays consistent across CLIs).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedBinary {
    pub path: PathBuf,
    pub source: String,
}

/// User-facing launch-option set surfaced by the launcher and Settings
/// modal. Each adapter populates it from its own runtime introspection
/// surface (Claude: minified-bundle scan; Codex: `codex debug models`,
/// `codex completion`, etc.). Schema is intentionally CLI-agnostic.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptions {
    /// Models the picker should offer. Stable identifier in `id`,
    /// `display_name` for the UI, optional `description`.
    pub models: Vec<ModelOption>,
    /// Reasoning / effort levels in display order.
    pub effort_levels: Vec<EffortOption>,
    /// Sandbox / permission modes the CLI accepts as arg values.
    pub permission_modes: Vec<PermissionOption>,
    /// CLI flag pills to render in the launcher (excluding flags with
    /// dedicated UI controls — model, sandbox, effort).
    pub flag_pills: Vec<FlagPill>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub default_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffortOption {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlagPill {
    pub flag: String,
    pub description: Option<String>,
}

pub struct SpawnContext<'a> {
    pub app: &'a tauri::AppHandle,
    pub working_dir: &'a str,
    pub session_id: &'a str,
    pub proxy_port: Option<u16>,
}

/// Per-CLI behavior. Implementations are stateless; runtime caches
/// (e.g. last-known binary path) live in the calling layer.
// [CC-01] CliAdapter trait: detect/version/build_spawn/launch_options; adapter_for(CliKind) returns Box<dyn CliAdapter>
pub trait CliAdapter {
    /// Locate the binary. Mirrors the 5-step chain in
    /// `commands/cli.rs::detect_claude_cli_details_sync` for Claude;
    /// Codex uses its own chain.
    fn detect(&self) -> Result<DetectedBinary, String>;

    /// `<bin> --version`, normalized. Reserved for a future
    /// version-display Tauri command surfaced in the status bar.
    #[allow(dead_code)]
    fn version(&self, bin: &std::path::Path) -> Result<String, String>;

    /// Build the `SpawnSpec` from the session config. Encapsulates env
    /// stripping, inspector hook injection (Claude only), and any
    /// CLI-specific arg building.
    fn build_spawn(&self, cfg: &SessionConfig) -> Result<SpawnSpec, String>;

    /// Optional adapter-owned mutations that require app state not
    /// available inside `build_spawn` (for example Codex spawn-env
    /// sidecars and proxy provider args).
    fn post_build(&self, _ctx: &SpawnContext<'_>, _spec: &mut SpawnSpec) -> Result<(), String> {
        Ok(())
    }

    /// User-facing launch options surfaced by the launcher. Adapters
    /// fetch these at runtime from the binary; the result is cached
    /// at the call site.
    fn launch_options(&self) -> Result<LaunchOptions, String>;
}

/// Resolve an adapter for a `CliKind`. Stateless; cheap to call.
pub fn adapter_for(kind: CliKind) -> Box<dyn CliAdapter> {
    match kind {
        CliKind::Claude => Box::new(claude::ClaudeAdapter),
        CliKind::Codex => Box::new(codex::CodexAdapter),
    }
}

/// Tauri command: build a `SpawnSpec` for the given session config.
/// Dispatches to the right adapter based on `config.cli`.
// [CC-02] build_cli_spawn: dispatch via config.cli -> adapter_for -> build_spawn; cli_launch_options returns per-CLI models/effort/permission/flag-pills
// [CC-06] Codex-only: layer the per-scope spawn-env sidecar on top of the adapter's env_overrides. Sidecars live in Code Tabs appdata (NOT the project tree); precedence project-local > project > user. The user-facing Env Vars tab writes to these sidecars; Codex itself doesn't read them — Code Tabs injects them at process spawn.
// [CC-09] Codex-only: inject a session-scoped Code Tabs model provider pointing at `http://127.0.0.1:<proxyPort>/s/<sessionId>/<basePath>` so the proxy can intercept the Responses API for prompt-rewrite rules + traffic logging without advertising WebSocket support. basePath depends on Codex auth mode (read from $CODEX_HOME/auth.json): ChatGPT/agent identity → `backend-api/codex`, API key → `v1`. Skipped if auth mode is unknown, the user already pinned `openai_base_url` or `model_provider` via -c/--config, or the proxy isn't running.
#[tauri::command]
pub async fn build_cli_spawn(
    app: tauri::AppHandle,
    proxy_state: tauri::State<'_, crate::proxy::ProxyState>,
    config: SessionConfig,
    session_id: String,
) -> Result<SpawnSpec, String> {
    let cli = config.cli;
    let working_dir = config.working_dir.clone();
    let mut spec =
        tauri::async_runtime::spawn_blocking(move || adapter_for(config.cli).build_spawn(&config))
            .await
            .map_err(|e| format!("join error: {e}"))??;

    let ctx = SpawnContext {
        app: &app,
        working_dir: &working_dir,
        session_id: &session_id,
        proxy_port: proxy_state.port(),
    };
    adapter_for(cli).post_build(&ctx, &mut spec)?;

    Ok(spec)
}

const CODE_TABS_CODEX_PROXY_PROVIDER_PREFIX: &str = "code-tabs-proxy";
const CODE_TABS_PROXY_DISABLED: &str = "CODE_TABS_PROXY_DISABLED";
const CODE_TABS_PROXY_PROVIDER_ID_ENV: &str = "CODE_TABS_PROXY_PROVIDER_ID";
const CODE_TABS_PROXY_HEADERS: &str = "CODE_TABS_PROXY_HEADERS";

fn codex_auth_mode_uses_chatgpt_backend(auth_mode: Option<&str>) -> bool {
    matches!(
        auth_mode,
        Some("chatgpt" | "chatgptAuthTokens" | "agentIdentity")
    )
}

fn quote_toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| format!("\"{value}\""))
}

fn push_codex_config(args: &mut Vec<String>, key: &str, value: String) {
    args.push("-c".into());
    args.push(format!("{key}={value}"));
}

fn reserved_proxy_env(key: &str) -> bool {
    matches!(
        key,
        CODE_TABS_PROXY_DISABLED | CODE_TABS_PROXY_PROVIDER_ID_ENV | CODE_TABS_PROXY_HEADERS
    )
}

fn proxy_control_env_keys() -> &'static [&'static str] {
    &[
        CODE_TABS_PROXY_DISABLED,
        CODE_TABS_PROXY_PROVIDER_ID_ENV,
        CODE_TABS_PROXY_HEADERS,
    ]
}

fn env_value<'a>(env: &'a [(String, Option<String>)], key: &str) -> Option<&'a str> {
    env.iter()
        .rev()
        .find(|(k, _)| k == key)
        .and_then(|(_, v)| v.as_deref())
}

fn env_truthy(env: &[(String, Option<String>)], key: &str) -> bool {
    env_value(env, key)
        .map(|value| matches!(value, "1" | "true" | "TRUE" | "yes" | "on"))
        .unwrap_or(false)
}

fn valid_bare_toml_key(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn sanitize_codex_provider_component(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn proxy_provider_id(env: &[(String, Option<String>)], session_id: &str, spawn_id: &str) -> String {
    let prefix = env_value(env, CODE_TABS_PROXY_PROVIDER_ID_ENV)
        .filter(|value| valid_bare_toml_key(value))
        .unwrap_or(CODE_TABS_CODEX_PROXY_PROVIDER_PREFIX);
    let prefix = sanitize_codex_provider_component(prefix);
    let session = sanitize_codex_provider_component(session_id);
    let spawn = sanitize_codex_provider_component(spawn_id);
    format!("{prefix}-{session}-{spawn}")
}

fn proxy_headers(env: &[(String, Option<String>)]) -> Vec<(String, String)> {
    let mut headers = vec![
        (
            "OpenAI-Organization".to_string(),
            "OPENAI_ORGANIZATION".to_string(),
        ),
        ("OpenAI-Project".to_string(), "OPENAI_PROJECT".to_string()),
    ];
    let Some(raw) = env_value(env, CODE_TABS_PROXY_HEADERS) else {
        return headers;
    };
    for item in raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        let Some((header, env_var)) = item.split_once(':') else {
            continue;
        };
        let header = header.trim();
        let env_var = env_var.trim();
        if valid_bare_toml_key(header) && valid_bare_toml_key(env_var) {
            headers.push((header.to_string(), env_var.to_string()));
        }
    }
    headers
}

fn codex_proxy_config_args(
    existing_args: &[String],
    env: &[(String, Option<String>)],
    port: u16,
    session_id: &str,
    auth_mode: Option<&str>,
) -> (Vec<String>, Option<String>) {
    if session_id.is_empty()
        || auth_mode.is_none()
        || env_truthy(env, CODE_TABS_PROXY_DISABLED)
        || has_codex_config_override(existing_args, "openai_base_url")
        || has_codex_config_override(existing_args, "model_provider")
    {
        return (Vec::new(), None);
    }

    let base_path = if codex_auth_mode_uses_chatgpt_backend(auth_mode) {
        "backend-api/codex"
    } else {
        "v1"
    };
    let url = format!("http://127.0.0.1:{port}/s/{session_id}/{base_path}");
    let spawn_id = uuid::Uuid::new_v4().simple().to_string();
    let provider = proxy_provider_id(env, session_id, &spawn_id);
    let mut args = Vec::new();

    push_codex_config(
        &mut args,
        &format!("model_providers.{provider}.name"),
        quote_toml_string("OpenAI"),
    );
    push_codex_config(
        &mut args,
        &format!("model_providers.{provider}.base_url"),
        quote_toml_string(&url),
    );
    push_codex_config(
        &mut args,
        &format!("model_providers.{provider}.wire_api"),
        quote_toml_string("responses"),
    );
    push_codex_config(
        &mut args,
        &format!("model_providers.{provider}.requires_openai_auth"),
        "true".into(),
    );
    for (header, env_var) in proxy_headers(env) {
        push_codex_config(
            &mut args,
            &format!("model_providers.{provider}.env_http_headers.{header}"),
            quote_toml_string(&env_var),
        );
    }
    push_codex_config(
        &mut args,
        &format!("model_providers.{provider}.supports_websockets"),
        "false".into(),
    );
    push_codex_config(&mut args, "model_provider", quote_toml_string(&provider));
    (args, Some(provider))
}

/// Returns true if the Codex argv already pins `<key>=...` via `-c`/`--config`.
/// Mirrors the previous frontend-side `hasCodexConfigOverride` helper so a user
/// who set the override via Env Vars / extra-flags isn't silently overridden.
fn has_codex_config_override(args: &[String], key: &str) -> bool {
    let prefix = format!("{key}=");
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "-c" || arg == "--config" {
            if let Some(value) = iter.next() {
                if value.trim_start().starts_with(&prefix) {
                    return true;
                }
            }
            continue;
        }
        if let Some(rest) = arg.strip_prefix("--config=") {
            if rest.trim_start().starts_with(&prefix) {
                return true;
            }
        }
        if let Some(rest) = arg.strip_prefix("-c") {
            if rest.trim_start().starts_with(&prefix) {
                return true;
            }
        }
    }
    false
}

/// Tauri command: discover launch options (models, effort levels,
/// permission modes, flag pills) for the given CLI.
#[tauri::command]
pub async fn cli_launch_options(cli: CliKind) -> Result<LaunchOptions, String> {
    tauri::async_runtime::spawn_blocking(move || adapter_for(cli).launch_options())
        .await
        .map_err(|e| format!("join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::{codex_proxy_config_args, has_codex_config_override};

    fn args(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }

    fn env(s: &[(&str, &str)]) -> Vec<(String, Option<String>)> {
        s.iter()
            .map(|(k, v)| (k.to_string(), Some(v.to_string())))
            .collect()
    }

    #[test]
    fn detects_separated_dash_c_override() {
        assert!(has_codex_config_override(
            &args(&["-c", "openai_base_url=http://x"]),
            "openai_base_url"
        ));
    }

    #[test]
    fn detects_separated_long_config_override() {
        assert!(has_codex_config_override(
            &args(&["--config", "openai_base_url=\"http://x\""]),
            "openai_base_url"
        ));
    }

    #[test]
    fn detects_combined_dash_c_override() {
        assert!(has_codex_config_override(
            &args(&["-copenai_base_url=http://x"]),
            "openai_base_url"
        ));
    }

    #[test]
    fn detects_equals_long_config_override() {
        assert!(has_codex_config_override(
            &args(&["--config=openai_base_url=http://x"]),
            "openai_base_url"
        ));
    }

    #[test]
    fn does_not_detect_unrelated_keys() {
        assert!(!has_codex_config_override(
            &args(&["-c", "model_reasoning_effort=high"]),
            "openai_base_url"
        ));
        assert!(!has_codex_config_override(&args(&[]), "openai_base_url"));
    }

    #[test]
    fn does_not_detect_key_as_substring() {
        // `chatgpt_base_url=...` must not satisfy a check for `openai_base_url`.
        assert!(!has_codex_config_override(
            &args(&["-c", "chatgpt_base_url=http://x"]),
            "openai_base_url"
        ));
    }

    #[test]
    fn codex_proxy_config_uses_chatgpt_backend_and_disables_websockets() {
        let (argv, provider) = codex_proxy_config_args(&[], &[], 4567, "sid-1", Some("chatgpt"));
        let provider = provider.expect("provider id");
        let joined = argv.join("\n");

        assert!(provider.starts_with("code-tabs-proxy-sid-1-"));
        assert!(joined.contains(&format!("model_provider=\"{provider}\"")));
        assert!(joined.contains(&format!("model_providers.{provider}.name=\"OpenAI\"")));
        assert!(joined.contains(&format!(
            "model_providers.{provider}.supports_websockets=false"
        )));
        assert!(joined.contains(&format!(
            "model_providers.{provider}.requires_openai_auth=true"
        )));
        assert!(joined.contains(&format!(
            "model_providers.{provider}.env_http_headers.OpenAI-Organization"
        )));
        assert!(joined.contains("http://127.0.0.1:4567/s/sid-1/backend-api/codex"));
        assert!(!joined.contains("openai_base_url="));
    }

    #[test]
    fn codex_proxy_config_uses_v1_for_api_key_auth() {
        let (argv, provider) = codex_proxy_config_args(&[], &[], 4567, "sid-1", Some("apikey"));
        let joined = argv.join("\n");

        assert!(provider.is_some());
        assert!(joined.contains("http://127.0.0.1:4567/s/sid-1/v1"));
    }

    #[test]
    fn codex_proxy_config_skips_when_auth_mode_is_unknown() {
        let (argv, provider) = codex_proxy_config_args(&[], &[], 4567, "sid-1", None);

        assert_eq!(provider, None);
        assert!(argv.is_empty());
    }

    #[test]
    fn codex_proxy_config_respects_user_provider_overrides() {
        let existing = args(&["-c", "model_provider=\"custom\""]);
        let (argv, provider) =
            codex_proxy_config_args(&existing, &[], 4567, "sid-1", Some("chatgpt"));

        assert_eq!(provider, None);
        assert!(argv.is_empty());
    }

    #[test]
    fn codex_proxy_config_respects_user_base_url_overrides() {
        let existing = args(&["--config=openai_base_url=http://x"]);
        let (argv, provider) =
            codex_proxy_config_args(&existing, &[], 4567, "sid-1", Some("chatgpt"));

        assert_eq!(provider, None);
        assert!(argv.is_empty());
    }

    #[test]
    fn codex_proxy_config_can_be_disabled_by_env() {
        let (argv, provider) = codex_proxy_config_args(
            &[],
            &env(&[("CODE_TABS_PROXY_DISABLED", "1")]),
            4567,
            "sid-1",
            Some("chatgpt"),
        );

        assert_eq!(provider, None);
        assert!(argv.is_empty());
    }

    #[test]
    fn codex_proxy_config_accepts_provider_and_header_env() {
        let (argv, provider) = codex_proxy_config_args(
            &[],
            &env(&[
                ("CODE_TABS_PROXY_PROVIDER_ID", "custom-proxy"),
                ("CODE_TABS_PROXY_HEADERS", "OpenAI-Beta:OPENAI_BETA"),
            ]),
            4567,
            "sid-1",
            Some("chatgpt"),
        );
        let provider = provider.expect("provider id");
        let joined = argv.join("\n");

        assert!(provider.starts_with("custom-proxy-sid-1-"));
        assert!(joined.contains(&format!("model_provider=\"{provider}\"")));
        assert!(joined.contains(&format!(
            "model_providers.{provider}.env_http_headers.OpenAI-Beta"
        )));
    }
}
