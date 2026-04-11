/// Bash-specific compression: strip ANSI escape codes.
///
/// Terminal output often contains ANSI escape sequences for colors, cursor
/// movement, etc. These are purely visual and waste tokens. Stripping them
/// is safe -- the model doesn't need color codes to understand command output.
///
/// Matches the standard ANSI CSI pattern: ESC [ <params> <final byte>
/// Also strips OSC sequences: ESC ] ... ST

pub fn compress(input: &str) -> String {
    if !input.contains('\x1b') {
        return input.to_string();
    }

    let mut result = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    // Track the start of the current non-escape segment
    let mut seg_start = 0;

    while i < len {
        if bytes[i] == 0x1b {
            // Flush the text segment before this escape
            if seg_start < i {
                result.push_str(&input[seg_start..i]);
            }

            if i + 1 >= len {
                // Lone ESC at end of input -- skip it
                i += 1;
                seg_start = i;
                continue;
            }
            match bytes[i + 1] {
                // CSI sequence: ESC [ <params> <final byte>
                b'[' => {
                    i += 2;
                    // Skip parameter bytes (0x30-0x3F) and intermediate bytes (0x20-0x2F)
                    while i < len && bytes[i] >= 0x20 && bytes[i] <= 0x3F {
                        i += 1;
                    }
                    // Skip the final byte (0x40-0x7E)
                    if i < len && bytes[i] >= 0x40 && bytes[i] <= 0x7E {
                        i += 1;
                    }
                }
                // OSC sequence: ESC ] ... (ST = ESC \ or BEL)
                b']' => {
                    i += 2;
                    while i < len {
                        if bytes[i] == 0x07 {
                            // BEL terminates OSC
                            i += 1;
                            break;
                        }
                        if bytes[i] == 0x1b && i + 1 < len && bytes[i + 1] == b'\\' {
                            // ST (ESC \) terminates OSC
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                }
                // Two-character escape (ESC + single char like ESC(B for charset)
                _ => {
                    i += 2;
                }
            }
            seg_start = i;
        } else {
            i += 1;
        }
    }

    // Flush any remaining text segment
    if seg_start < len {
        result.push_str(&input[seg_start..len]);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_ansi_passthrough() {
        let input = "hello world\nline two\n";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn strips_color_codes() {
        let input = "\x1b[32mPASS\x1b[0m test_foo\n\x1b[31mFAIL\x1b[0m test_bar\n";
        assert_eq!(compress(input), "PASS test_foo\nFAIL test_bar\n");
    }

    #[test]
    fn strips_bold_underline() {
        let input = "\x1b[1mbold\x1b[0m \x1b[4munderline\x1b[0m\n";
        assert_eq!(compress(input), "bold underline\n");
    }

    #[test]
    fn strips_256_color() {
        let input = "\x1b[38;5;196mred text\x1b[0m\n";
        assert_eq!(compress(input), "red text\n");
    }

    #[test]
    fn strips_rgb_color() {
        let input = "\x1b[38;2;255;0;0mred\x1b[0m\n";
        assert_eq!(compress(input), "red\n");
    }

    #[test]
    fn strips_cursor_movement() {
        let input = "\x1b[2Kline cleared\n\x1b[1Amoved up\n";
        assert_eq!(compress(input), "line cleared\nmoved up\n");
    }

    #[test]
    fn empty_input() {
        assert_eq!(compress(""), "");
    }

    #[test]
    fn preserves_non_escape_special_chars() {
        let input = "path\\to\\file\ttab\n";
        assert_eq!(compress(input), input);
    }

    #[test]
    fn real_cargo_test_output() {
        let input = "   \x1b[1m\x1b[32mCompiling\x1b[0m claude-tabs v0.45.0\n\
                      \x1b[1m\x1b[32m    Finished\x1b[0m `test` profile in 4.80s\n\
                      running 14 tests\n\
                      test test_basic ... \x1b[32mok\x1b[0m\n";
        let expected = "   Compiling claude-tabs v0.45.0\n\
                        \x20   Finished `test` profile in 4.80s\n\
                        running 14 tests\n\
                        test test_basic ... ok\n";
        assert_eq!(compress(input), expected);
    }

    #[test]
    fn strips_osc_with_bel() {
        // OSC for setting terminal title
        let input = "\x1b]0;my title\x07output here\n";
        assert_eq!(compress(input), "output here\n");
    }

    #[test]
    fn strips_osc_with_st() {
        let input = "\x1b]0;my title\x1b\\output here\n";
        assert_eq!(compress(input), "output here\n");
    }

    #[test]
    fn idempotent() {
        let input = "\x1b[32mgreen\x1b[0m text\n";
        let first = compress(input);
        let second = compress(&first);
        assert_eq!(first, second);
    }

    #[test]
    fn preserves_utf8() {
        let input = "\x1b[32mhéllo\x1b[0m café résumé\n";
        assert_eq!(compress(input), "héllo café résumé\n");
    }

    #[test]
    fn preserves_cjk_and_emoji() {
        let input = "\x1b[1m你好世界\x1b[0m 🎉\n";
        assert_eq!(compress(input), "你好世界 🎉\n");
    }

    #[test]
    fn multiple_escapes_in_sequence() {
        let input = "\x1b[1m\x1b[4m\x1b[31mformatted\x1b[0m\n";
        assert_eq!(compress(input), "formatted\n");
    }

    #[test]
    fn escape_at_end_of_string() {
        let input = "text\x1b[0m";
        assert_eq!(compress(input), "text");
    }

    #[test]
    fn lone_escape_at_end() {
        // Malformed: ESC at end of string with nothing after
        let input = "text\x1b";
        // Should not panic -- just skip the lone ESC
        let result = compress(input);
        assert_eq!(result, "text");
    }
}
