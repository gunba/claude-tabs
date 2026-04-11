/// Tool output compression orchestrator.
///
/// Compresses tool_result content in API request bodies to reduce token usage.
/// All transformations are deterministic and idempotent, ensuring prompt cache
/// safety: the same input always produces the same output, so prefixes that
/// were cached on a previous request will still match.
///
/// Used by both the Anthropic passthrough path and the Codex translation path.

use std::collections::HashMap;

use serde_json::Value;

mod bash;
mod generic;
mod glob;
mod grep;
mod json_minify;

// ── Public API ──────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct CompressionStats {
    pub tool_results_found: usize,
    pub tool_results_compressed: usize,
    pub original_bytes: usize,
    pub compressed_bytes: usize,
}

impl CompressionStats {
    pub fn saved_bytes(&self) -> usize {
        self.original_bytes.saturating_sub(self.compressed_bytes)
    }

    pub fn saved_pct(&self) -> f64 {
        if self.original_bytes == 0 {
            return 0.0;
        }
        (self.saved_bytes() as f64 / self.original_bytes as f64) * 100.0
    }
}

/// Build a lookup from `tool_use_id` → `tool_name` by scanning all messages
/// for `tool_use` content blocks. Returns an empty map if parsing fails.
pub fn build_tool_id_map(messages: &[Value]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for msg in messages {
        if let Some(blocks) = msg.get("content").and_then(|v| v.as_array()) {
            for block in blocks {
                if block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                    if let (Some(id), Some(name)) = (
                        block.get("id").and_then(|v| v.as_str()),
                        block.get("name").and_then(|v| v.as_str()),
                    ) {
                        map.insert(id.to_string(), name.to_string());
                    }
                }
            }
        }
    }
    map
}

/// Compress a single tool result text string.
///
/// Applies compressors in order:
/// 1. Generic whitespace normalization (all tools except Read/Write/Edit)
/// 2. Tool-specific compressor (Grep path dedup, Glob prefix strip)
/// 3. JSON minification (all eligible tools, no-op if not JSON)
///
/// Read, Write, and Edit outputs are **never compressed** because the model
/// uses their exact content to construct text-matching edits. Any modification
/// (trailing whitespace strip, CRLF normalization, blank line collapse) would
/// cause downstream Edit tool calls to fail when the old_string no longer
/// matches the actual file content.
pub fn compress_tool_result(text: &str, tool_name: Option<&str>) -> String {
    if text.is_empty() {
        return String::new();
    }

    // Tools whose output represents exact file content that the model may
    // reference for subsequent edits -- never compress these.
    match tool_name {
        Some("Read" | "Write" | "Edit" | "NotebookEdit") => return text.to_string(),
        _ => {}
    }

    // Try JSON minification first: if the content is valid JSON, minify it
    // directly and skip generic whitespace normalization. This prevents
    // generic::compress from corrupting JSON strings that contain embedded
    // newlines with trailing whitespace (generic splits on \n and trims lines,
    // which would break string values spanning multiple lines).
    let minified = json_minify::compress(text);
    if minified.len() < text.len() {
        return minified;
    }

    let mut result = generic::compress(text);

    match tool_name {
        Some("Bash") => result = bash::compress(&result),
        Some("Grep") => result = grep::compress(&result),
        Some("Glob") => result = glob::compress(&result),
        _ => {}
    }

    result
}

/// Compress tool_result content in an Anthropic-format request body.
///
/// Parses the JSON body, walks through messages to find tool_result blocks,
/// compresses their content, and re-serializes. Returns the original body
/// unchanged on parse failure.
pub fn compress_tool_results_in_body(body: &[u8]) -> (Vec<u8>, CompressionStats) {
    let mut stats = CompressionStats::default();

    let mut json: Value = match serde_json::from_slice(body) {
        Ok(j) => j,
        Err(_) => return (body.to_vec(), stats),
    };

    let messages = match json.get("messages").and_then(|v| v.as_array()) {
        Some(m) => m.clone(),
        None => return (body.to_vec(), stats),
    };

    let tool_map = build_tool_id_map(&messages);

    if let Some(msgs) = json.get_mut("messages").and_then(|v| v.as_array_mut()) {
        for msg in msgs.iter_mut() {
            compress_tool_results_in_message(msg, &tool_map, &mut stats);
        }
    }

    let result = serde_json::to_vec(&json).unwrap_or_else(|_| body.to_vec());
    (result, stats)
}

// ── Internal helpers ────────────────────────────────────────────────

fn compress_tool_results_in_message(
    msg: &mut Value,
    tool_map: &HashMap<String, String>,
    stats: &mut CompressionStats,
) {
    let content = match msg.get_mut("content") {
        Some(c) => c,
        None => return,
    };

    if let Value::Array(blocks) = content {
        for block in blocks.iter_mut() {
            if block.get("type").and_then(|v| v.as_str()) != Some("tool_result") {
                continue;
            }
            let tool_use_id = block
                .get("tool_use_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let tool_name = tool_map.get(tool_use_id).map(|s| s.as_str());
            compress_tool_result_block(block, tool_name, stats);
        }
    }
}

fn compress_tool_result_block(
    block: &mut Value,
    tool_name: Option<&str>,
    stats: &mut CompressionStats,
) {
    stats.tool_results_found += 1;

    let inner_content = match block.get_mut("content") {
        Some(c) => c,
        None => return,
    };

    match inner_content {
        Value::String(s) => {
            compress_string_in_place(s, tool_name, stats);
        }
        Value::Array(arr) => {
            for item in arr.iter_mut() {
                if item.get("type").and_then(|v| v.as_str()) == Some("text") {
                    if let Some(Value::String(ref mut s)) = item.get_mut("text") {
                        compress_string_in_place(s, tool_name, stats);
                    }
                }
            }
        }
        _ => {}
    }
}

fn compress_string_in_place(
    s: &mut String,
    tool_name: Option<&str>,
    stats: &mut CompressionStats,
) {
    let original_len = s.len();
    let compressed = compress_tool_result(s, tool_name);
    stats.original_bytes += original_len;
    if compressed.len() < original_len {
        stats.compressed_bytes += compressed.len();
        stats.tool_results_compressed += 1;
        *s = compressed;
    } else {
        stats.compressed_bytes += original_len;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_tool_id_map_extracts_names() {
        let messages = vec![
            json!({
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "/a.rs"}},
                    {"type": "tool_use", "id": "t2", "name": "Grep", "input": {"pattern": "foo"}}
                ]
            }),
            json!({
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "file contents"},
                    {"type": "tool_result", "tool_use_id": "t2", "content": "grep results"}
                ]
            }),
        ];
        let map = build_tool_id_map(&messages);
        assert_eq!(map.get("t1").unwrap(), "Read");
        assert_eq!(map.get("t2").unwrap(), "Grep");
    }

    #[test]
    fn build_tool_id_map_handles_empty() {
        assert!(build_tool_id_map(&[]).is_empty());
    }

    #[test]
    fn compress_tool_result_generic_only() {
        let input = "hello  \r\nworld  \r\n";
        let result = compress_tool_result(input, None);
        assert_eq!(result, "hello\nworld\n");
    }

    #[test]
    fn compress_tool_result_grep() {
        let input = "/src/a.rs:1:code\n/src/a.rs:2:more\n/src/a.rs:3:stuff\n";
        let result = compress_tool_result(input, Some("Grep"));
        assert!(result.starts_with("--- /src/a.rs\n"));
        assert!(result.contains(":1:code"));
    }

    #[test]
    fn compress_tool_result_glob() {
        let input = "/home/user/project/src/a.rs\n\
                      /home/user/project/src/b.rs\n\
                      /home/user/project/src/c.rs\n";
        let result = compress_tool_result(input, Some("Glob"));
        assert!(result.starts_with("[prefix:"));
        assert!(result.contains("a.rs"));
    }

    #[test]
    fn compress_tool_result_json() {
        let input = "{\n  \"key\": \"value\",\n  \"num\": 42\n}\n";
        let result = compress_tool_result(input, Some("Bash"));
        assert_eq!(result, r#"{"key":"value","num":42}"#);
    }

    #[test]
    fn compress_tool_result_empty() {
        assert_eq!(compress_tool_result("", None), "");
    }

    #[test]
    fn read_output_never_compressed() {
        // Read output must be preserved exactly for downstream Edit tool matching
        let input = "1\thello  \r\n2\t\r\n3\t\r\n4\t\r\n5\tworld  \r\n";
        let result = compress_tool_result(input, Some("Read"));
        assert_eq!(result, input);
    }

    #[test]
    fn write_output_never_compressed() {
        let input = "File written with trailing spaces  \r\n";
        let result = compress_tool_result(input, Some("Write"));
        assert_eq!(result, input);
    }

    #[test]
    fn edit_output_never_compressed() {
        let input = "old content  \r\nnew content  \r\n";
        let result = compress_tool_result(input, Some("Edit"));
        assert_eq!(result, input);
    }

    #[test]
    fn compress_body_basic() {
        let body = json!({
            "model": "claude-opus-4-6",
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "echo hi"}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "hello  \r\nworld  \r\n"}
                ]}
            ]
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let (result, stats) = compress_tool_results_in_body(&body_bytes);
        let result_json: Value = serde_json::from_slice(&result).unwrap();

        let tool_result_content = result_json["messages"][1]["content"][0]["content"]
            .as_str()
            .unwrap();
        assert_eq!(tool_result_content, "hello\nworld\n");
        assert_eq!(stats.tool_results_found, 1);
        assert_eq!(stats.tool_results_compressed, 1);
        assert!(stats.saved_bytes() > 0);
    }

    #[test]
    fn compress_body_array_content() {
        let body = json!({
            "model": "claude-opus-4-6",
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "echo hi"}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": [
                        {"type": "text", "text": "{\n  \"result\": \"ok\"\n}"}
                    ]}
                ]}
            ]
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let (result, stats) = compress_tool_results_in_body(&body_bytes);
        let result_json: Value = serde_json::from_slice(&result).unwrap();

        let text = result_json["messages"][1]["content"][0]["content"][0]["text"]
            .as_str()
            .unwrap();
        assert_eq!(text, r#"{"result":"ok"}"#);
        assert_eq!(stats.tool_results_found, 1);
    }

    #[test]
    fn compress_body_invalid_json_passthrough() {
        let body = b"not json at all";
        let (result, stats) = compress_tool_results_in_body(body);
        assert_eq!(result, body);
        assert_eq!(stats.tool_results_found, 0);
    }

    #[test]
    fn compress_body_no_messages_passthrough() {
        let body = json!({"model": "claude-opus-4-6"});
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let (_, stats) = compress_tool_results_in_body(&body_bytes);
        assert_eq!(stats.tool_results_found, 0);
    }

    #[test]
    fn compress_body_non_tool_result_untouched() {
        let body = json!({
            "model": "claude-opus-4-6",
            "messages": [
                {"role": "user", "content": "Hello  \r\n"},
                {"role": "assistant", "content": [
                    {"type": "text", "text": "Response  \r\n"}
                ]}
            ]
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let (result, stats) = compress_tool_results_in_body(&body_bytes);
        let result_json: Value = serde_json::from_slice(&result).unwrap();

        // User string content should be untouched
        assert_eq!(result_json["messages"][0]["content"], "Hello  \r\n");
        // Assistant text block should be untouched
        assert_eq!(
            result_json["messages"][1]["content"][0]["text"],
            "Response  \r\n"
        );
        assert_eq!(stats.tool_results_found, 0);
    }

    #[test]
    fn compress_body_orphan_tool_result_gets_generic() {
        // tool_result with no matching tool_use -- generic compression only
        let body = json!({
            "model": "claude-opus-4-6",
            "messages": [
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "orphan", "content": "hello  \r\n"}
                ]}
            ]
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let (result, stats) = compress_tool_results_in_body(&body_bytes);
        let result_json: Value = serde_json::from_slice(&result).unwrap();

        let content = result_json["messages"][0]["content"][0]["content"]
            .as_str()
            .unwrap();
        assert_eq!(content, "hello\n");
        assert_eq!(stats.tool_results_compressed, 1);
    }

    #[test]
    fn stats_calculation() {
        let stats = CompressionStats {
            tool_results_found: 10,
            tool_results_compressed: 5,
            original_bytes: 1000,
            compressed_bytes: 700,
        };
        assert_eq!(stats.saved_bytes(), 300);
        assert!((stats.saved_pct() - 30.0).abs() < 0.01);
    }

    #[test]
    fn stats_zero_original() {
        let stats = CompressionStats::default();
        assert_eq!(stats.saved_pct(), 0.0);
    }

    #[test]
    fn compress_body_deterministic() {
        let body = json!({
            "model": "claude-opus-4-6",
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "t1", "name": "Grep", "input": {"pattern": "foo"}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "/src/a.rs:1:code\n/src/a.rs:2:more\n/src/a.rs:3:stuff\n"}
                ]}
            ]
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let (result1, _) = compress_tool_results_in_body(&body_bytes);
        let (result2, _) = compress_tool_results_in_body(&body_bytes);
        assert_eq!(result1, result2);
    }

    #[test]
    fn compress_body_idempotent() {
        let body = json!({
            "model": "claude-opus-4-6",
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "echo hi"}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "hello  \r\n\r\n\r\nworld  \r\n"}
                ]}
            ]
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let (first, _) = compress_tool_results_in_body(&body_bytes);
        let (second, _) = compress_tool_results_in_body(&first);
        assert_eq!(first, second);
    }

    #[test]
    fn compress_body_read_output_preserved() {
        // Read output must pass through untouched for Edit tool compatibility
        let body = json!({
            "model": "claude-opus-4-6",
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "/a.rs"}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "1\thello  \r\n2\t\r\n3\t\r\n4\t\r\n5\tworld  \r\n"}
                ]}
            ]
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let (result, stats) = compress_tool_results_in_body(&body_bytes);
        let result_json: Value = serde_json::from_slice(&result).unwrap();

        let content = result_json["messages"][1]["content"][0]["content"]
            .as_str()
            .unwrap();
        // Must be exactly the original -- CRLF, trailing spaces, blank lines all preserved
        assert_eq!(content, "1\thello  \r\n2\t\r\n3\t\r\n4\t\r\n5\tworld  \r\n");
        assert_eq!(stats.tool_results_found, 1);
        assert_eq!(stats.tool_results_compressed, 0);
    }
}
