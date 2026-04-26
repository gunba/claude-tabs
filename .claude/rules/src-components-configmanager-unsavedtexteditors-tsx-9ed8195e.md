---
paths:
  - "src/components/ConfigManager/UnsavedTextEditors.tsx"
---

# src/components/ConfigManager/UnsavedTextEditors.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Unsaved text editor guard
Config-modal text editors register pre-save snapshots through an UnsavedTextEditorRegistry context; the modal collects pending changes when the user attempts to close, switch CLI, switch project dir, switch tab, or close the OS window — and prompts via DiscardChangesDialog with a per-editor unified diff preview.

- [UT-01 L4] Each editor calls useUnsavedTextEditor(id, getChange) which registers a snapshot callback in a parent-provided UnsavedTextEditorRegistry (Map<id, () => Snapshot>). getChanges() iterates registered callbacks, returning {id, title, before, after} for editors where before !== after. ConfigManager wraps content in <UnsavedTextEditorProvider registry={...}>; runWithUnsavedEditorGuard(action) collects changes and either calls action() immediately (no changes) or stashes the action in pendingDiscardActionRef and shows DiscardChangesDialog. The dialog renders a per-editor list and a unified diff preview (buildDiffPreview with 2-line context windows + 140-row cap). Cancel keeps editing; Discard runs the pending action (close modal, switch cli, switch tab, switch projectDir, or window close).
  - src/components/ConfigManager/UnsavedTextEditors.tsx:L13 (registry interface), src/components/ConfigManager/UnsavedTextEditors.tsx:L60 (useUnsavedTextEditor hook), src/components/ConfigManager/ConfigManager.tsx:L33 (CONFIG_MANAGER_CLOSE_REQUEST_EVENT), src/components/ConfigManager/ConfigManager.tsx:L85 (DiscardChangesDialog), src/components/ConfigManager/ConfigManager.tsx:L289 (runWithUnsavedEditorGuard), src/components/ConfigManager/ConfigManager.tsx:L319 (window onCloseRequested guard), src/components/ConfigManager/ConfigManager.css (config-discard-* selectors)
