---
paths:
  - "src/components/RightPanel/RightPanel.tsx"
---

# src/components/RightPanel/RightPanel.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Debug Panel

- [DP-02 L66] [DP-02] DebugPanel is shown as a tab inside RightPanel when activeTab === 'debug' and observability is enabled. If observability is disabled while the debug tab is selected, RightPanel resets to the response tab. There is no dedicated keyboard shortcut to toggle it; users switch RightPanel tabs via the tab row at the top of the panel.

## RightPanel

- [RI-04 L13] RightPanel.tsx defines BASE_TABS in the order [search, response, session, notes, debug]. The old Activity tab is gone; the Response and Session tabs each render ActivityPanel with mode='response' or mode='session'. The Debug tab is included only when runtime observabilityInfo.observabilityEnabled is true, and an effect resets the selected tab to response if observability becomes unavailable while debug is selected. Notes renders NotesPanel and Search renders SearchPanel.
