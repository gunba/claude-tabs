/// Glob output common-prefix stripping.
///
/// Glob outputs are file-path-only lists with a long common directory prefix.
/// This compressor strips the common prefix and adds a header:
///
///   [prefix: C:\Users\jorda\PycharmProjects\claude_tabs\]
///   src/App.tsx
///   src/main.tsx
///
/// Detection: all non-empty lines must look like file paths (start with /
/// or drive letter, no `:digit` after path). Minimum 3 lines and minimum
/// 10-char common prefix.

pub fn compress(input: &str) -> String {
    let lines: Vec<&str> = input.lines().collect();
    let non_empty: Vec<&str> = lines.iter().filter(|l| !l.is_empty()).copied().collect();

    if non_empty.len() < 3 {
        return input.to_string();
    }

    // All non-empty lines must look like file paths
    if !non_empty.iter().all(|l| looks_like_path(l)) {
        return input.to_string();
    }

    let prefix = common_path_prefix(&non_empty);
    if prefix.len() < 10 {
        return input.to_string();
    }

    let mut result = String::with_capacity(input.len());
    result.push_str("[prefix: ");
    result.push_str(&prefix);
    result.push_str("]\n");

    for line in &lines {
        if line.is_empty() {
            result.push('\n');
        } else {
            result.push_str(line.strip_prefix(prefix.as_str()).unwrap_or(line));
            result.push('\n');
        }
    }

    // Remove final trailing \n if original didn't have one
    if !input.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    result
}

/// Check if a string looks like a file path.
///
/// Accepts:
/// - Unix paths: /path/to/file
/// - Windows paths: C:\path\to\file or C:/path/to/file
///
/// Rejects lines containing `:digit` after the path start (those are grep output).
fn looks_like_path(line: &str) -> bool {
    let bytes = line.as_bytes();
    if bytes.is_empty() {
        return false;
    }

    let is_unix = bytes[0] == b'/';
    let is_windows = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');

    if !is_unix && !is_windows {
        return false;
    }

    // Reject if it looks like grep output (has :digit pattern after path start)
    let search_start = if is_windows { 3 } else { 1 };
    for i in search_start..bytes.len().saturating_sub(1) {
        if bytes[i] == b':' && bytes[i + 1].is_ascii_digit() {
            return false;
        }
    }

    true
}

/// Find the common directory prefix across all paths.
/// Returns the prefix including the trailing separator.
fn common_path_prefix(paths: &[&str]) -> String {
    if paths.is_empty() {
        return String::new();
    }

    let first = paths[0].as_bytes();
    let mut last_sep = 0;

    'outer: for (i, &byte) in first.iter().enumerate() {
        for path in &paths[1..] {
            let path_bytes = path.as_bytes();
            if i >= path_bytes.len() || path_bytes[i] != byte {
                break 'outer;
            }
        }
        if byte == b'/' || byte == b'\\' {
            last_sep = i + 1;
        }
    }

    // Return up to and including the last separator
    paths[0][..last_sep].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_path_passthrough() {
        let input = "not a path\nalso not\nnope\n";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn too_few_lines_passthrough() {
        let input = "/src/a.rs\n/src/b.rs\n";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn basic_unix_prefix_strip() {
        let input = "/home/user/project/src/a.rs\n\
                      /home/user/project/src/b.rs\n\
                      /home/user/project/src/c.rs\n";
        let expected = "[prefix: /home/user/project/src/]\n\
                        a.rs\n\
                        b.rs\n\
                        c.rs\n";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn basic_windows_prefix_strip() {
        let input = "C:\\Users\\jorda\\project\\src\\a.rs\n\
                      C:\\Users\\jorda\\project\\src\\b.rs\n\
                      C:\\Users\\jorda\\project\\src\\c.rs\n";
        let expected = "[prefix: C:\\Users\\jorda\\project\\src\\]\n\
                        a.rs\n\
                        b.rs\n\
                        c.rs\n";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn different_subdirectories() {
        let input = "/home/user/project/src/main.rs\n\
                      /home/user/project/tests/test.rs\n\
                      /home/user/project/Cargo.toml\n";
        let expected = "[prefix: /home/user/project/]\n\
                        src/main.rs\n\
                        tests/test.rs\n\
                        Cargo.toml\n";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn short_prefix_passthrough() {
        // Common prefix "/a/" is only 3 chars -- below 10-char minimum
        let input = "/a/one.rs\n/a/two.rs\n/a/three.rs\n";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn no_common_prefix_passthrough() {
        let input = "/path/a/file.rs\n\
                      /other/b/file.rs\n\
                      /third/c/file.rs\n";
        // Common prefix is just "/" which is 1 char
        assert_eq!(compress(input), input);
    }

    #[test]
    fn grep_output_rejected() {
        // Lines with :digit patterns should not be treated as glob paths
        let input = "/src/main.rs:42:code\n\
                      /src/main.rs:43:more\n\
                      /src/main.rs:44:stuff\n";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn preserves_no_trailing_newline() {
        let input = "/home/user/project/a.rs\n\
                      /home/user/project/b.rs\n\
                      /home/user/project/c.rs";
        let expected = "[prefix: /home/user/project/]\n\
                        a.rs\n\
                        b.rs\n\
                        c.rs";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn idempotent() {
        let input = "/home/user/project/src/a.rs\n\
                      /home/user/project/src/b.rs\n\
                      /home/user/project/src/c.rs\n";
        let first = compress(input);
        let second = compress(&first);
        // After first compression, lines start with "[prefix:" and relative paths,
        // which don't look like absolute paths, so it passes through.
        assert_eq!(first, second);
    }

    #[test]
    fn empty_lines_preserved() {
        let input = "/home/user/project/a.rs\n\
                      \n\
                      /home/user/project/b.rs\n\
                      /home/user/project/c.rs\n";
        // Empty line makes it fail: "all non-empty lines must look like paths"
        // passes, but there's still an empty line to preserve
        let result = compress(input);
        assert!(result.contains("[prefix: /home/user/project/]"));
        assert!(result.contains("\n\n")); // empty line preserved
    }

    #[test]
    fn common_path_prefix_basic() {
        let paths = vec!["/a/b/c.rs", "/a/b/d.rs", "/a/b/e.rs"];
        assert_eq!(common_path_prefix(&paths), "/a/b/");
    }

    #[test]
    fn common_path_prefix_root_only() {
        let paths = vec!["/a/file.rs", "/b/file.rs"];
        assert_eq!(common_path_prefix(&paths), "/");
    }

    #[test]
    fn common_path_prefix_empty() {
        let paths: Vec<&str> = vec![];
        assert_eq!(common_path_prefix(&paths), "");
    }

    #[test]
    fn looks_like_path_accepts_unix() {
        assert!(looks_like_path("/src/main.rs"));
    }

    #[test]
    fn looks_like_path_accepts_windows() {
        assert!(looks_like_path("C:\\src\\main.rs"));
        assert!(looks_like_path("C:/src/main.rs"));
    }

    #[test]
    fn looks_like_path_rejects_grep() {
        assert!(!looks_like_path("/src/main.rs:42:code"));
    }

    #[test]
    fn looks_like_path_rejects_text() {
        assert!(!looks_like_path("not a path"));
    }
}
