/// Generic whitespace normalization applied to all tool results.
///
/// Deterministic and idempotent: applying twice yields the same result.
///
/// Transforms:
/// 1. CRLF → LF
/// 2. Strip trailing whitespace per line
/// 3. Collapse 3+ consecutive blank lines to 1 blank line

pub fn compress(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }

    // Step 1: CRLF → LF (also handles stray \r)
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");

    let mut result = String::with_capacity(normalized.len());
    let mut consecutive_blanks: u32 = 0;
    let mut first_line = true;

    for line in normalized.split('\n') {
        let trimmed = line.trim_end();

        if trimmed.is_empty() {
            consecutive_blanks += 1;
            if consecutive_blanks <= 1 {
                if !first_line {
                    result.push('\n');
                }
                // Push the empty line itself (will be followed by \n on next iteration)
            }
            // Skip if 2+ consecutive blanks
        } else {
            // Reset blank counter on non-empty line
            consecutive_blanks = 0;
            if !first_line {
                result.push('\n');
            }
            result.push_str(trimmed);
        }
        first_line = false;
    }

    // Preserve a single trailing newline if the original had one
    if normalized.ends_with('\n') && !result.ends_with('\n') {
        result.push('\n');
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input() {
        assert_eq!(compress(""), "");
    }

    #[test]
    fn no_changes_needed() {
        assert_eq!(compress("hello\nworld\n"), "hello\nworld\n");
    }

    #[test]
    fn strips_trailing_whitespace() {
        assert_eq!(compress("hello   \nworld  \n"), "hello\nworld\n");
    }

    #[test]
    fn normalizes_crlf() {
        assert_eq!(compress("hello\r\nworld\r\n"), "hello\nworld\n");
    }

    #[test]
    fn normalizes_stray_cr() {
        assert_eq!(compress("hello\rworld\r"), "hello\nworld\n");
    }

    #[test]
    fn collapses_multiple_blank_lines() {
        assert_eq!(
            compress("a\n\n\n\nb\n"),
            "a\n\nb\n"
        );
    }

    #[test]
    fn preserves_single_blank_line() {
        assert_eq!(compress("a\n\nb\n"), "a\n\nb\n");
    }

    #[test]
    fn collapses_many_blank_lines() {
        assert_eq!(
            compress("a\n\n\n\n\n\n\n\nb\n"),
            "a\n\nb\n"
        );
    }

    #[test]
    fn combined_transforms() {
        assert_eq!(
            compress("hello  \r\n\r\n\r\n\r\nworld  \r\n"),
            "hello\n\nworld\n"
        );
    }

    #[test]
    fn idempotent() {
        let input = "a  \r\n\r\n\r\n\r\nb  \n\n\n\nc\n";
        let first = compress(input);
        let second = compress(&first);
        assert_eq!(first, second);
    }

    #[test]
    fn all_blank_input() {
        assert_eq!(compress("\n\n\n\n"), "\n");
    }

    #[test]
    fn trailing_whitespace_only_lines() {
        assert_eq!(
            compress("   \n   \n   \n"),
            "\n"
        );
    }

    #[test]
    fn no_trailing_newline_preserved() {
        assert_eq!(compress("hello"), "hello");
    }

    #[test]
    fn mixed_crlf_and_lf() {
        assert_eq!(
            compress("a\r\nb\nc\r\n"),
            "a\nb\nc\n"
        );
    }

    #[test]
    fn blank_lines_with_whitespace_between_content() {
        // Lines that are only whitespace should count as blank
        assert_eq!(
            compress("a\n   \n   \n   \nb\n"),
            "a\n\nb\n"
        );
    }

    #[test]
    fn preserves_leading_indentation() {
        assert_eq!(
            compress("  fn main() {\n    println!(\"hi\");\n  }\n"),
            "  fn main() {\n    println!(\"hi\");\n  }\n"
        );
    }
}
