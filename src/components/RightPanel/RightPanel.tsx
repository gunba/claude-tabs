import { useEffect } from "react";
import { useSettingsStore } from "../../store/settings";
import { useRuntimeStore } from "../../store/runtime";
import { ActivityPanel } from "../ActivityPanel/ActivityPanel";
import { SearchPanel } from "../SearchPanel/SearchPanel";
import { DebugPanel } from "../DebugPanel/DebugPanel";
import { IconFolder, IconSearch, IconTerminal } from "../Icons/Icons";
import "./RightPanel.css";

type RightPanelTab = "activity" | "search" | "debug";

const BASE_TABS = [
  { id: "activity" as const, label: "Activity", icon: <IconFolder size={12} /> },
  { id: "search" as const, label: "Search", icon: <IconSearch size={12} /> },
  { id: "debug" as const, label: "Debug Log", icon: <IconTerminal size={12} /> },
];

export function RightPanel() {
  const debugBuild = useRuntimeStore((s) => s.observabilityInfo.debugBuild);
  const rightPanelTab = useSettingsStore((s) => s.rightPanelTab);
  const setRightPanelTab = useSettingsStore((s) => s.setRightPanelTab);

  useEffect(() => {
    if (!debugBuild && rightPanelTab === "debug") {
      setRightPanelTab("activity");
    }
  }, [debugBuild, rightPanelTab, setRightPanelTab]);

  const activeTab: RightPanelTab = !debugBuild && rightPanelTab === "debug"
    ? "activity"
    : rightPanelTab;
  const tabs = debugBuild ? BASE_TABS : BASE_TABS.filter((tab) => tab.id !== "debug");

  return (
    <aside className="right-panel">
      <div className="right-panel-header">
        <div className="right-panel-tabs" role="tablist" aria-label="Right panel tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`right-panel-tab${activeTab === tab.id ? " right-panel-tab-active" : ""}`}
              onClick={() => setRightPanelTab(tab.id)}
            >
              <span className="right-panel-tab-icon">{tab.icon}</span>
              <span className="right-panel-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="right-panel-content">
        {activeTab === "activity" && <ActivityPanel />}
        {activeTab === "search" && <SearchPanel />}
        {activeTab === "debug" && debugBuild && <DebugPanel />}
      </div>
    </aside>
  );
}
