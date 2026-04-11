/// Grep content-mode path deduplication.
///
/// Grep output repeats the full file path on every line:
///   /path/to/file.rs:42:    some code
///   /path/to/file.rs:43:    more code
///
/// Compressed form prints the path once as a header:
///   --- /path/to/file.rs
///   :42:    some code
///   :43:    more code
///
/// Detection: at least 60% of non-empty lines must match the grep
/// `path:linenum:content` pattern. Returns input unchanged if not detected.
///
/// Handles both Unix (/path/to/file) and Windows (C:\path\to\file) paths.

pub fn compress(input: &str) -> String {
    let lines: Vec<&str> = input.lines().collect();
    if lines.len() < 3 {
        return input.to_string();
    }

    let non_empty: Vec<&str> = lines.iter().copied().filter(|l| !l.is_empty()).collect();
    if non_empty.is_empty() {
        return input.to_string();
    }

    let grep_count = non_empty.iter().filter(|l| is_grep_line(l)).count();
    if grep_count * 100 / non_empty.len() < 60 {
        return input.to_string();
    }

    let mut result = String::with_capacity(input.len());
    let mut current_path: Option<&str> = None;

    for line in &lines {
        if let Some((path, rest)) = split_grep_line(line) {
            if current_path != Some(path) {
                current_path = Some(path);
                result.push_str("--- ");
                result.push_str(path);
                result.push('\n');
            }
            result.push_str(rest);
            result.push('\n');
        } else {
            // Non-grep line (e.g. separator, context marker) -- reset path context
            current_path = None;
            result.push_str(line);
            result.push('\n');
        }
    }

    // Remove final trailing \n if the original didn't end with one
    if !input.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    result
}

/// Parse a grep output line into (path, ":linenum:content").
///
/// Matches patterns like:
///   /unix/path/file.rs:42:content
///   C:\windows\path\file.rs:42:content
///   C:/mixed/path/file.rs:42:content
fn split_grep_line(line: &str) -> Option<(&str, &str)> {
    let bytes = line.as_bytes();
    if bytes.is_empty() {
        return None;
    }

    // Determine the start position to search for :digit
    // Skip drive letter prefix on Windows (e.g., "C:")
    let search_start = if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        3
    } else if bytes[0] == b'/' {
        1
    } else {
        return None;
    };

    // Scan for :<digit> pattern (separating path from line number)
    for i in search_start..bytes.len().saturating_sub(1) {
        if bytes[i] == b':' && bytes[i + 1].is_ascii_digit() {
            let path = &line[..i];
            let rest = &line[i..]; // ":linenum:content" or ":linenum"
            return Some((path, rest));
        }
    }

    None
}

fn is_grep_line(line: &str) -> bool {
    split_grep_line(line).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_grep_passthrough() {
        let input = "this is regular text\nno grep format here\n";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn too_few_lines_passthrough() {
        let input = "/path/file.rs:1:code\n/path/file.rs:2:more\n";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn basic_unix_dedup() {
        let input = "/src/main.rs:10:fn main() {\n\
                      /src/main.rs:11:    println!(\"hi\");\n\
                      /src/main.rs:12:}\n";
        let expected = "--- /src/main.rs\n\
                        :10:fn main() {\n\
                        :11:    println!(\"hi\");\n\
                        :12:}\n";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn basic_windows_dedup() {
        let input = "C:\\Users\\jorda\\src\\main.rs:10:fn main() {\n\
                      C:\\Users\\jorda\\src\\main.rs:11:    body\n\
                      C:\\Users\\jorda\\src\\main.rs:12:}\n";
        let expected = "--- C:\\Users\\jorda\\src\\main.rs\n\
                        :10:fn main() {\n\
                        :11:    body\n\
                        :12:}\n";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn multiple_files() {
        let input = "/src/a.rs:1:line1\n\
                      /src/a.rs:2:line2\n\
                      /src/b.rs:10:lineA\n\
                      /src/b.rs:11:lineB\n";
        let expected = "--- /src/a.rs\n\
                        :1:line1\n\
                        :2:line2\n\
                        --- /src/b.rs\n\
                        :10:lineA\n\
                        :11:lineB\n";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn mixed_grep_and_non_grep_below_threshold() {
        // Only 2 out of 5 non-empty lines are grep format (40%) -- below 60% threshold
        let input = "/file.rs:1:code\n\
                      not grep\n\
                      not grep either\n\
                      /file.rs:2:more\n\
                      still not grep\n";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn windows_forward_slash_paths() {
        let input = "C:/Users/jorda/file.rs:1:one\n\
                      C:/Users/jorda/file.rs:2:two\n\
                      C:/Users/jorda/file.rs:3:three\n";
        let expected = "--- C:/Users/jorda/file.rs\n\
                        :1:one\n\
                        :2:two\n\
                        :3:three\n";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn no_trailing_newline_preserved() {
        let input = "/src/a.rs:1:one\n\
                      /src/a.rs:2:two\n\
                      /src/a.rs:3:three";
        let expected = "--- /src/a.rs\n\
                        :1:one\n\
                        :2:two\n\
                        :3:three";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn idempotent() {
        let input = "/src/a.rs:1:one\n\
                      /src/a.rs:2:two\n\
                      /src/b.rs:3:three\n";
        let first = compress(input);
        let second = compress(&first);
        // After first compression, format changes so it won't re-match grep pattern.
        // The compressed form starts with "--- " not a path, so it passes through.
        assert_eq!(first, second);
    }

    #[test]
    fn content_with_colons() {
        // Line content contains colons -- the first :digit after path is the split point
        let input = "/file.rs:42:let x = map[\"key:value\"];\n\
                      /file.rs:43:let y = \"a:b:c\";\n\
                      /file.rs:44:// comment\n";
        let expected = "--- /file.rs\n\
                        :42:let x = map[\"key:value\"];\n\
                        :43:let y = \"a:b:c\";\n\
                        :44:// comment\n";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn long_real_world_paths() {
        let base = "C:\\Users\\jorda\\PycharmProjects\\claude_tabs\\.claude\\worktrees\\agent-acbae7f9\\src\\store\\settings.ts";
        let input = format!(
            "{base}:106:  commandBarExpanded: boolean;\n\
             {base}:107:  commandRefreshTrigger: number;\n\
             {base}:108:  proxyPort: number;\n"
        );
        let expected = format!(
            "--- {base}\n\
             :106:  commandBarExpanded: boolean;\n\
             :107:  commandRefreshTrigger: number;\n\
             :108:  proxyPort: number;\n"
        );
        assert_eq!(compress(&input), expected);
    }

    #[test]
    fn split_grep_line_basic() {
        let (path, rest) = split_grep_line("/src/main.rs:42:code").unwrap();
        assert_eq!(path, "/src/main.rs");
        assert_eq!(rest, ":42:code");
    }

    #[test]
    fn split_grep_line_windows() {
        let (path, rest) = split_grep_line("C:\\src\\main.rs:42:code").unwrap();
        assert_eq!(path, "C:\\src\\main.rs");
        assert_eq!(rest, ":42:code");
    }

    #[test]
    fn split_grep_line_no_match() {
        assert!(split_grep_line("not a grep line").is_none());
        assert!(split_grep_line("").is_none());
    }
}
