pub mod auth;
pub mod types;
pub mod translate_req;
pub mod translate_resp;
pub mod stream;

use tokio::io::AsyncWriteExt;
use crate::session::types::ModelProvider;

const CODEX_API_URL: &str = "https://api.openai.com/v1/responses";

/// Resolve the Codex model name from the request model and provider config.
fn resolve_codex_model(model: Option<&str>, provider: &ModelProvider) -> String {
    let primary = provider.codex_primary_model.as_deref().unwrap_or("gpt-5.4");
    let small = provider.codex_small_model.as_deref().unwrap_or("gpt-5.4-mini");

    let model = match model {
        Some(m) => m,
        None => return primary.to_string(),
    };

    let lower = model.to_lowercase();
    // Strip ANSI formatting codes (e.g., [1m] bold markers from subagents)
    let cleaned: String = {
        let mut s = lower.clone();
        while let Some(start) = s.find('[') {
            if let Some(end) = s[start..].find(']') {
                s = format!("{}{}", &s[..start], &s[start + end + 1..]);
            } else {
                break;
            }
        }
        s
    };

    // Check if this is a Claude family model
    if cleaned.contains("haiku") {
        return small.to_string();
    }
    if cleaned.contains("sonnet") || cleaned.contains("opus") || cleaned.starts_with("claude") {
        return primary.to_string();
    }

    // Not a Claude model — could be a Codex model name already, pass through
    model.to_string()
}

/// [PR-02] Translate Anthropic-style requests and streaming responses
/// through the OpenAI Responses API for the OpenAI Codex provider.
pub async fn handle_request(
    tcp_stream: &mut tokio::net::TcpStream,
    _method: &str,
    _path: &str,
    _headers: &[(String, String)],
    body: &[u8],
    provider: &ModelProvider,
    auth_state: &auth::CodexAuthState,
) -> Result<(), Box<dyn std::error::Error>> {
    // Get auth token
    let access_token = match auth_state.get_access_token().await {
        Ok(t) => t,
        Err(e) => {
            send_error(tcp_stream, 401, &format!("Codex auth failed: {e}")).await;
            return Ok(());
        }
    };

    // Extract model from request and resolve to Codex model
    let req_model = extract_model_from_body(body);
    let codex_model = resolve_codex_model(req_model.as_deref(), provider);

    // Translate request
    let codex_body = match translate_req::translate_request(body, &codex_model) {
        Ok(b) => b,
        Err(e) => {
            send_error(tcp_stream, 400, &format!("Request translation failed: {e}")).await;
            return Ok(());
        }
    };

    let is_streaming = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("stream").and_then(|s| s.as_bool()))
        .unwrap_or(true);

    let original_model = req_model.as_deref().unwrap_or("claude-opus-4-6");

    // Send to OpenAI
    let client = reqwest::Client::new();
    let resp = match client
        .post(CODEX_API_URL)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Type", "application/json")
        .body(codex_body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            send_error(tcp_stream, 502, &format!("Codex upstream failed: {e}")).await;
            return Ok(());
        }
    };

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        send_error(tcp_stream, status, &format!("Codex API error: {body}")).await;
        return Ok(());
    }

    if is_streaming {
        // Streaming response — translate SSE events
        let resp_headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n"
        );
        tcp_stream.write_all(resp_headers.as_bytes()).await?;

        let mut translator = stream::StreamTranslator::new(original_model);
        tcp_stream.write_all(&translator.message_start()).await?;
        tcp_stream.flush().await?;

        // Read the streaming response
        use futures_util::StreamExt;
        let mut byte_stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = byte_stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(_) => break,
            };
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            // Process complete lines
            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() { continue; }

                let output = translator.process_line(&line);
                if !output.is_empty() {
                    tcp_stream.write_all(&output).await?;
                    tcp_stream.flush().await?;
                }
            }
        }

        // Process any remaining buffer
        if !buffer.trim().is_empty() {
            let output = translator.process_line(buffer.trim());
            if !output.is_empty() {
                tcp_stream.write_all(&output).await?;
                tcp_stream.flush().await?;
            }
        }
    } else {
        // Non-streaming response — translate and return
        let codex_body = resp.bytes().await.map_err(|e| format!("Read error: {e}"))?;
        let translated = match translate_resp::translate_response(&codex_body, original_model) {
            Ok(b) => b,
            Err(e) => {
                send_error(tcp_stream, 500, &format!("Response translation failed: {e}")).await;
                return Ok(());
            }
        };

        let resp_str = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            translated.len(),
        );
        tcp_stream.write_all(resp_str.as_bytes()).await?;
        tcp_stream.write_all(&translated).await?;
        tcp_stream.flush().await?;
    }

    Ok(())
}

fn extract_model_from_body(body: &[u8]) -> Option<String> {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("model").and_then(|m| m.as_str()).map(|s| s.to_string()))
}

async fn send_error(stream: &mut tokio::net::TcpStream, status: u16, msg: &str) {
    let body = serde_json::json!({
        "type": "error",
        "error": { "type": "proxy_error", "message": msg }
    }).to_string();
    let reason = match status {
        400 => "Bad Request",
        401 => "Unauthorized",
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

    #[test]
    fn test_resolve_codex_model_haiku() {
        let provider = ModelProvider {
            id: "codex".into(),
            name: "Codex".into(),
            kind: "openai_codex".into(),
            predefined: true,
            model_mappings: Vec::new(),
            base_url: None,
            api_key: None,
            socks5_proxy: None,
            codex_primary_model: Some("gpt-5.4".into()),
            codex_small_model: Some("gpt-5.4-mini".into()),
        };
        assert_eq!(resolve_codex_model(Some("claude-haiku-4-5"), &provider), "gpt-5.4-mini");
        assert_eq!(resolve_codex_model(Some("haiku"), &provider), "gpt-5.4-mini");
    }

    #[test]
    fn test_resolve_codex_model_opus() {
        let provider = ModelProvider {
            id: "codex".into(),
            name: "Codex".into(),
            kind: "openai_codex".into(),
            predefined: true,
            model_mappings: Vec::new(),
            base_url: None,
            api_key: None,
            socks5_proxy: None,
            codex_primary_model: Some("gpt-5.4".into()),
            codex_small_model: Some("gpt-5.4-mini".into()),
        };
        assert_eq!(resolve_codex_model(Some("claude-opus-4-6"), &provider), "gpt-5.4");
        assert_eq!(resolve_codex_model(Some("opus"), &provider), "gpt-5.4");
        assert_eq!(resolve_codex_model(Some("sonnet"), &provider), "gpt-5.4");
    }

    #[test]
    fn test_resolve_codex_model_passthrough() {
        let provider = ModelProvider {
            id: "codex".into(),
            name: "Codex".into(),
            kind: "openai_codex".into(),
            predefined: true,
            model_mappings: Vec::new(),
            base_url: None,
            api_key: None,
            socks5_proxy: None,
            codex_primary_model: Some("gpt-5.4".into()),
            codex_small_model: Some("gpt-5.4-mini".into()),
        };
        // Non-Claude model passes through unchanged
        assert_eq!(resolve_codex_model(Some("gpt-5.4"), &provider), "gpt-5.4");
    }
}
