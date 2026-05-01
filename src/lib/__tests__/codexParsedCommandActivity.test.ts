import { describe, expect, it } from "vitest";
import { codexParsedCommandActivities } from "../codexParsedCommandActivity";

describe("codexParsedCommandActivities", () => {
  it("maps Codex read parsed commands to file reads", () => {
    expect(codexParsedCommandActivities([
      { type: "read", cmd: "sed -n '1,20p' src/App.tsx", path: "src/App.tsx" },
    ], "/repo")).toEqual([
      { path: "/repo/src/App.tsx", kind: "read", isFolder: false },
    ]);
  });

  it("maps Codex list and search parsed commands to folder searches", () => {
    expect(codexParsedCommandActivities([
      { type: "list_files", cmd: "find src -type f", path: "src" },
      { type: "search", cmd: "rg TODO", path: null },
    ], "/repo")).toEqual([
      { path: "/repo/src", kind: "searched", isFolder: true },
      { path: "/repo", kind: "searched", isFolder: true },
    ]);
  });

  it("ignores unknown commands", () => {
    expect(codexParsedCommandActivities([
      { type: "unknown", cmd: "echo $FILE" },
    ], "/repo")).toEqual([]);
  });
});
