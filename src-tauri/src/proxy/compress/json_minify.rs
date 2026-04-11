/// JSON detection and minification for tool result content.
///
/// If the entire input (trimmed) is valid JSON, minify it by removing
/// pretty-printing whitespace. Returns input unchanged if it's not JSON.
///
/// Deterministic: serde_json with default features uses BTreeMap (sorted keys),
/// so the same JSON input always produces the same minified output.

pub fn compress(input: &str) -> String {
    let trimmed = input.trim();

    if trimmed.is_empty() {
        return input.to_string();
    }

    // Fast rejection: must start with { or [
    if !trimmed.starts_with('{') && !trimmed.starts_with('[') {
        return input.to_string();
    }

    match serde_json::from_str::<serde_json::Value>(trimmed) {
        Ok(parsed) => serde_json::to_string(&parsed).unwrap_or_else(|_| input.to_string()),
        Err(_) => input.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input() {
        assert_eq!(compress(""), "");
    }

    #[test]
    fn non_json_passthrough() {
        let input = "This is just regular text output from a command";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn minifies_pretty_object() {
        let input = r#"{
    "name": "test",
    "value": 42,
    "nested": {
        "a": true,
        "b": null
    }
}"#;
        let result = compress(input);
        // serde_json with BTreeMap sorts keys alphabetically
        assert_eq!(
            result,
            r#"{"name":"test","nested":{"a":true,"b":null},"value":42}"#
        );
    }

    #[test]
    fn minifies_pretty_array() {
        let input = r#"[
    "one",
    "two",
    "three"
]"#;
        assert_eq!(compress(input), r#"["one","two","three"]"#);
    }

    #[test]
    fn already_minified_is_idempotent() {
        let input = r#"{"a":1,"b":2}"#;
        let result = compress(input);
        assert_eq!(result, input);
        assert_eq!(compress(&result), result);
    }

    #[test]
    fn invalid_json_passthrough() {
        let input = r#"{ broken json: "no quotes on key" }"#;
        assert_eq!(compress(input), input);
    }

    #[test]
    fn json_with_surrounding_whitespace() {
        let input = "  \n  { \"key\": \"value\" }  \n  ";
        let result = compress(input);
        assert_eq!(result, r#"{"key":"value"}"#);
    }

    #[test]
    fn non_json_starting_with_brace_like_text() {
        // This is not valid JSON but starts with {
        let input = "{this is not json}";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn nested_arrays_and_objects() {
        let input = r#"{
    "data": [
        {
            "id": 1,
            "tags": [
                "a",
                "b"
            ]
        },
        {
            "id": 2,
            "tags": []
        }
    ]
}"#;
        let result = compress(input);
        assert_eq!(
            result,
            r#"{"data":[{"id":1,"tags":["a","b"]},{"id":2,"tags":[]}]}"#
        );
    }

    #[test]
    fn preserves_string_whitespace() {
        let input = r#"{"msg": "hello   world\n  indented"}"#;
        let result = compress(input);
        assert!(result.contains(r#"hello   world\n  indented"#));
    }

    #[test]
    fn deterministic_key_ordering() {
        // serde_json BTreeMap sorts keys alphabetically
        let input = r#"{"z": 1, "a": 2, "m": 3}"#;
        let r1 = compress(input);
        let r2 = compress(input);
        assert_eq!(r1, r2);
        assert_eq!(r1, r#"{"a":2,"m":3,"z":1}"#);
    }
}
