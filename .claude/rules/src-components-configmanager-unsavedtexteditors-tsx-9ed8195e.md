---
paths:
  - "src/components/ConfigManager/UnsavedTextEditors.tsx"
---

# src/components/ConfigManager/UnsavedTextEditors.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Unsaved text editor guard
Config-modal text editors register pre-save snapshots through an UnsavedTextEditorRegistry context; the modal collects pending changes when the user attempts to close, switch CLI, switch project dir, switch tab, or close the OS window — and prompts via DiscardChangesDialog with a per-editor unified diff preview.

- [UT-01 L4] Config-modal text editors register pre/post-save snapshots plus optional save callbacks through an UnsavedTextEditorRegistry context. getChanges() normalizes CRLF before comparing and returns {id,title,before,after,save?} for dirty editors. ConfigManager wraps content in UnsavedTextEditorProvider; close, tab switch, CLI switch, project switch, and OS-window close attempts collect pending changes and show DiscardChangesDialog with a per-editor unified diff preview. Keep editing cancels the pending action, Discard runs it, and Save changes is enabled only when every listed change exposes a save callback; save-all uses the registered callbacks, surfaces validation/save failures inline, refreshes remaining dirty snapshots, and guards global/native close requests while a save is in flight.
  - src/components/ConfigManager/UnsavedTextEditors.tsx:L13 (registry interface), src/components/ConfigManager/UnsavedTextEditors.tsx:L60 (useUnsavedTextEditor hook), src/components/ConfigManager/ConfigManager.tsx:L33 (CONFIG_MANAGER_CLOSE_REQUEST_EVENT), src/components/ConfigManager/ConfigManager.tsx:L85 (DiscardChangesDialog), src/components/ConfigManager/ConfigManager.tsx:L289 (runWithUnsavedEditorGuard), src/components/ConfigManager/ConfigManager.tsx:L319 (window onCloseRequested guard), src/components/ConfigManager/ConfigManager.css (config-discard-* selectors)
