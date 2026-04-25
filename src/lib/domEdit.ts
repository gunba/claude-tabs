// Helpers that mutate text inputs through the browser's edit history rather
// than via React's value prop. Programmatic value writes (setText, etc.) clear
// the native undo stack on most webview engines; execCommand('insertText') is
// the only API that pushes the edit onto that stack as a single undoable step.

export function replaceTextareaValue(el: HTMLTextAreaElement | HTMLInputElement | null, next: string): void {
  if (!el) return;
  if (el.value === next) return;
  el.focus();
  el.select();
  document.execCommand("insertText", false, next);
}

export function insertTextAtCursor(el: HTMLTextAreaElement | HTMLInputElement | null, text: string): void {
  if (!el) return;
  el.focus();
  document.execCommand("insertText", false, text);
}
