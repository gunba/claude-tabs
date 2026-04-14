---
paths:
  - "src/components/RightPanel/RightPanel.tsx"
---

# src/components/RightPanel/RightPanel.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## RightPanel

- [RI-04 L13] BASE_TABS in RightPanel.tsx is ordered [search, activity, debug] so that when the Search tab becomes visible (hasExecutedSearch), it appears before Activity in the tab bar. Response/Session pills (rendered after Activity) do not shift the Search tab position because Search is always first in the ordered list and filtered out when hidden.
- [RI-01 L39] The Response/Session view-mode toggle pill is rendered inline in the RightPanel tab row immediately after the 'Activity' tab button, not inside ActivityPanel. It is only visible when the Activity tab is active and a session is open (showPill = activeTab === 'activity' && !!activeTabId). The pill controls useSettingsStore.setActivityViewMode() — a global persisted setting, not per-session state. mode and setMode are sourced from useSettingsStore.
