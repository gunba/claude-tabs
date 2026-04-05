// [PT-22] TUI renderer detection — singleton flag, set once at app startup.
// When CLAUDE_CODE_NO_FLICKER is set in the process environment,
// Ink-specific workarounds (scrollback fix, write batching, focus-in
// after resize) are skipped to avoid interfering with the TUI renderer.

let _tuiMode = false;

export function initTuiMode(val: boolean): void {
  _tuiMode = val;
}

export function isTuiMode(): boolean {
  return _tuiMode;
}
