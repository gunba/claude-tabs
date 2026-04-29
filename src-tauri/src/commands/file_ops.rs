use crate::observability::{
    record_backend_perf_end, record_backend_perf_fail, record_backend_perf_start,
};
use tauri::AppHandle;

const MAX_SNAPSHOT_BYTES: usize = 500 * 1024;
const MAX_DIFF_BYTES: usize = 500 * 1024;
const DEFAULT_DIFF_CONTEXT_RADIUS: usize = 3;
const MAX_DIFF_CONTEXT_RADIUS: usize = 20;
const DIFF_TRUNCATED_MARKER: &str = "\n\n[diff truncated]\n";

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PathStatus {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
}

/// [RC-23] Stat a batch of paths in parallel via spawn_blocking.
/// Returns one entry per input path in the same order.
#[tauri::command]
pub async fn paths_exist(paths: Vec<String>) -> Vec<PathStatus> {
    tokio::task::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|p| match std::fs::metadata(&p) {
                Ok(meta) => PathStatus {
                    path: p,
                    exists: true,
                    is_dir: meta.is_dir(),
                },
                Err(_) => PathStatus {
                    path: p,
                    exists: false,
                    is_dir: false,
                },
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn compute_file_diff(
    file_path: String,
    before_content: Option<String>,
    context_radius: Option<usize>,
    app: AppHandle,
) -> Result<String, String> {
    let span_start = std::time::Instant::now();
    let context_radius = normalize_diff_context_radius(context_radius);
    let span_data = serde_json::json!({
        "filePath": file_path,
        "contextRadius": context_radius,
    });
    record_backend_perf_start(
        &app,
        "file_ops",
        None,
        "file_ops.compute_diff",
        span_data.clone(),
    );
    let result = tokio::task::spawn_blocking(move || {
        let current =
            std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {e}"))?;

        let old = before_content.as_deref().unwrap_or("");

        if old == current {
            return Ok(String::new());
        }

        Ok(truncate_diff(build_unified_diff(
            old,
            &current,
            &file_path,
            context_radius,
        )))
    })
    .await
    .map_err(|e| e.to_string())?;
    match result {
        Ok(diff) => {
            record_backend_perf_end(
                &app,
                "file_ops",
                None,
                "file_ops.compute_diff",
                span_start,
                500,
                span_data,
                serde_json::json!({
                    "diffLength": diff.len(),
                }),
            );
            Ok(diff)
        }
        Err(err) => {
            record_backend_perf_fail(
                &app,
                "file_ops",
                None,
                "file_ops.compute_diff",
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
pub async fn read_file_for_snapshot(file_path: String, app: AppHandle) -> Result<String, String> {
    let span_start = std::time::Instant::now();
    let span_data = serde_json::json!({ "filePath": file_path });
    record_backend_perf_start(
        &app,
        "file_ops",
        None,
        "file_ops.read_snapshot",
        span_data.clone(),
    );
    let result = tokio::task::spawn_blocking(move || {
        let metadata =
            std::fs::metadata(&file_path).map_err(|e| format!("Failed to stat file: {e}"))?;

        if metadata.len() > MAX_SNAPSHOT_BYTES as u64 {
            return Err(format!(
                "File too large for snapshot ({} bytes, max {})",
                metadata.len(),
                MAX_SNAPSHOT_BYTES
            ));
        }

        let content = std::fs::read(&file_path).map_err(|e| format!("Failed to read file: {e}"))?;
        String::from_utf8(content).map_err(|_| "File is not valid UTF-8".into())
    })
    .await
    .map_err(|e| e.to_string())?;
    match result {
        Ok(content) => {
            record_backend_perf_end(
                &app,
                "file_ops",
                None,
                "file_ops.read_snapshot",
                span_start,
                500,
                span_data,
                serde_json::json!({
                    "contentLength": content.len(),
                }),
            );
            Ok(content)
        }
        Err(err) => {
            record_backend_perf_fail(
                &app,
                "file_ops",
                None,
                "file_ops.read_snapshot",
                span_start,
                span_data,
                serde_json::json!({}),
                &err,
            );
            Err(err)
        }
    }
}

fn normalize_diff_context_radius(context_radius: Option<usize>) -> usize {
    context_radius
        .unwrap_or(DEFAULT_DIFF_CONTEXT_RADIUS)
        .min(MAX_DIFF_CONTEXT_RADIUS)
}

fn build_unified_diff(
    before_content: &str,
    current_content: &str,
    file_path: &str,
    context_radius: usize,
) -> String {
    let diff = similar::TextDiff::from_lines(before_content, current_content);
    let display_path = file_path.replace('\\', "/");
    let header_a = format!("a/{display_path}");
    let header_b = format!("b/{display_path}");

    diff.unified_diff()
        .context_radius(context_radius)
        .header(&header_a, &header_b)
        .to_string()
}

fn truncate_diff(diff: String) -> String {
    if diff.len() <= MAX_DIFF_BYTES {
        return diff;
    }

    let max_body_len = MAX_DIFF_BYTES.saturating_sub(DIFF_TRUNCATED_MARKER.len());
    let mut boundary = max_body_len.min(diff.len());
    while boundary > 0 && !diff.is_char_boundary(boundary) {
        boundary -= 1;
    }

    let mut truncated = diff[..boundary].to_string();
    truncated.push_str(DIFF_TRUNCATED_MARKER);
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_diff_context_radius_defaults_and_caps() {
        assert_eq!(
            normalize_diff_context_radius(None),
            DEFAULT_DIFF_CONTEXT_RADIUS
        );
        assert_eq!(normalize_diff_context_radius(Some(0)), 0);
        assert_eq!(
            normalize_diff_context_radius(Some(MAX_DIFF_CONTEXT_RADIUS + 1)),
            MAX_DIFF_CONTEXT_RADIUS
        );
    }

    #[test]
    fn build_unified_diff_honors_context_radius() {
        let before = "a\nb\nc\nd\ne\n";
        let after = "a\nb\nX\nd\ne\n";

        let no_context = build_unified_diff(before, after, "C:\\repo\\file.txt", 0);
        assert!(no_context.contains("--- a/C:/repo/file.txt"));
        assert!(no_context.contains("+++ b/C:/repo/file.txt"));
        assert!(no_context.contains("-c"));
        assert!(no_context.contains("+X"));
        assert!(!no_context.contains(" b\n"));
        assert!(!no_context.contains(" d\n"));

        let one_line_context = build_unified_diff(before, after, "C:\\repo\\file.txt", 1);
        assert!(one_line_context.contains(" b\n"));
        assert!(one_line_context.contains(" d\n"));
    }

    #[test]
    fn truncate_diff_caps_at_utf8_boundary() {
        let diff = "é".repeat(MAX_DIFF_BYTES);
        let truncated = truncate_diff(diff);
        assert!(truncated.len() <= MAX_DIFF_BYTES);
        assert!(truncated.ends_with(DIFF_TRUNCATED_MARKER));
    }
}
