import { describe, it, expect } from "vitest";
import { buildFileTree, flattenTree, allFolderPaths } from "../fileTree";
import type { FileActivity } from "../../types/activity";

function makeActivity(path: string, kind: "read" | "modified" | "created" = "read"): FileActivity {
  return {
    path,
    kind,
    agentId: null,
    toolName: "Read",
    timestamp: Date.now(),
    confirmed: true,
    isExternal: false,
    permissionDenied: false,
    permissionMode: null,
    toolInputData: null,
  };
}

function toMap(entries: FileActivity[]): Map<string, FileActivity> {
  return new Map(entries.map((e) => [e.path, e]));
}

describe("buildFileTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildFileTree(new Map(), "/workspace")).toEqual([]);
  });

  it("shows workspace root with relative paths for internal files", () => {
    const files = toMap([
      makeActivity("/workspace/src/app.ts"),
      makeActivity("/workspace/src/utils.ts"),
    ]);
    const tree = buildFileTree(files, "/workspace");

    // Root should be workspace name
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("workspace");
    expect(tree[0].isFile).toBe(false);

    // src folder with 2 files
    const src = tree[0].children[0];
    expect(src.name).toBe("src");
    expect(src.children).toHaveLength(2);
    expect(src.children[0].name).toBe("app.ts");
    expect(src.children[1].name).toBe("utils.ts");
  });

  it("preserves original full paths for file nodes (needed for shell_open)", () => {
    const files = toMap([makeActivity("/workspace/src/app.ts")]);
    const tree = buildFileTree(files, "/workspace");

    // Navigate to the file leaf
    let node = tree[0]; // workspace root
    while (!node.isFile && node.children.length > 0) {
      node = node.children[0];
    }
    expect(node.isFile).toBe(true);
    expect(node.fullPath).toBe("/workspace/src/app.ts");
  });

  it("compresses single-child directory chains (compact folders)", () => {
    const files = toMap([
      makeActivity("/workspace/src/components/Panel/ActivityPanel.tsx"),
    ]);
    const tree = buildFileTree(files, "/workspace");

    // workspace root
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("workspace");

    // src/components/Panel should be compressed into one node
    const compressed = tree[0].children[0];
    expect(compressed.name).toBe("src/components/Panel");
    expect(compressed.isFile).toBe(false);

    // The file is the child
    expect(compressed.children).toHaveLength(1);
    expect(compressed.children[0].name).toBe("ActivityPanel.tsx");
    expect(compressed.children[0].isFile).toBe(true);
  });

  it("does not compress directories with multiple children", () => {
    const files = toMap([
      makeActivity("/workspace/src/a.ts"),
      makeActivity("/workspace/src/b.ts"),
    ]);
    const tree = buildFileTree(files, "/workspace");

    const src = tree[0].children[0]; // workspace > src
    expect(src.name).toBe("src");
    expect(src.children).toHaveLength(2);
  });

  it("handles a single external file with prefix context preserved", () => {
    const files = toMap([
      makeActivity("/workspace/src/app.ts"),
      makeActivity("/external/lib/helper.ts"),
    ]);
    const tree = buildFileTree(files, "/workspace");

    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe("workspace");

    // External file should be under a prefix folder, not bare at root
    const extRoot = tree[1];
    expect(extRoot.isFile).toBe(false);
    // Navigate to the leaf
    let node = extRoot;
    while (!node.isFile && node.children.length > 0) {
      node = node.children[0];
    }
    expect(node.name).toBe("helper.ts");
    expect(node.isFile).toBe(true);
    expect(node.fullPath).toBe("/external/lib/helper.ts");
  });

  it("handles multiple external files with shared prefix", () => {
    const files = toMap([
      makeActivity("/external/lib/a.ts"),
      makeActivity("/external/lib/b.ts"),
    ]);
    const tree = buildFileTree(files, "/workspace");

    // Should have one root for external files
    expect(tree).toHaveLength(1);
    const extRoot = tree[0];
    expect(extRoot.isFile).toBe(false);

    // Navigate to find both files
    let folder = extRoot;
    while (!folder.isFile && folder.children.length === 1 && !folder.children[0].isFile) {
      folder = folder.children[0];
    }
    const fileNames = folder.children.map((c) => c.name).sort();
    expect(fileNames).toEqual(["a.ts", "b.ts"]);
  });

  it("handles external files with no shared prefix", () => {
    const files = toMap([
      makeActivity("/foo/a.ts"),
      makeActivity("/bar/b.ts"),
    ]);
    const tree = buildFileTree(files, "/workspace");

    // Two separate external roots
    expect(tree).toHaveLength(2);
    const names = tree.map((n) => n.name).sort();
    expect(names).toEqual(["bar", "foo"]);
  });

  it("handles Windows paths with backslashes", () => {
    const files = toMap([
      makeActivity("C:\\Users\\jorda\\project\\src\\app.ts"),
    ]);
    const tree = buildFileTree(files, "C:\\Users\\jorda\\project");

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("project");

    // Navigate to the file
    let node = tree[0];
    while (!node.isFile && node.children.length > 0) {
      node = node.children[0];
    }
    expect(node.name).toBe("app.ts");
    expect(node.isFile).toBe(true);
    // Original path preserved for shell_open
    expect(node.fullPath).toBe("C:\\Users\\jorda\\project\\src\\app.ts");
  });

  it("sorts folders before files", () => {
    const files = toMap([
      makeActivity("/workspace/file.ts"),
      makeActivity("/workspace/subdir/other.ts"),
    ]);
    const tree = buildFileTree(files, "/workspace");

    const wsRoot = tree[0];
    expect(wsRoot.children).toHaveLength(2);
    // subdir (folder) should come before file.ts (file)
    expect(wsRoot.children[0].name).toBe("subdir");
    expect(wsRoot.children[0].isFile).toBe(false);
    expect(wsRoot.children[1].name).toBe("file.ts");
    expect(wsRoot.children[1].isFile).toBe(true);
  });

  it("handles files at different depths", () => {
    const files = toMap([
      makeActivity("/workspace/a/b/c/deep.ts"),
      makeActivity("/workspace/a/shallow.ts"),
    ]);
    const tree = buildFileTree(files, "/workspace");

    const a = tree[0].children[0]; // workspace > a
    expect(a.name).toBe("a");
    expect(a.children).toHaveLength(2);
    // Compressed "b/c" folder before "shallow.ts" file
    expect(a.children[0].isFile).toBe(false);
    expect(a.children[1].name).toBe("shallow.ts");
    expect(a.children[1].isFile).toBe(true);
  });

  it("normalizes mixed separator paths to avoid duplicates", () => {
    const files = toMap([
      makeActivity("C:/Users/jorda/project/a.ts"),
    ]);
    const tree = buildFileTree(files, "C:\\Users\\jorda\\project");

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("project");
    const leaf = tree[0].children[0];
    expect(leaf.name).toBe("a.ts");
    expect(leaf.isFile).toBe(true);
  });
});

describe("flattenTree", () => {
  it("flattens all nodes when all folders expanded", () => {
    const files = toMap([
      makeActivity("/workspace/a/b.ts"),
      makeActivity("/workspace/c.ts"),
    ]);
    const tree = buildFileTree(files, "/workspace");
    const expanded = allFolderPaths(tree);
    const rows = flattenTree(tree, expanded);

    // workspace, a, b.ts, c.ts
    expect(rows).toHaveLength(4);
    expect(rows[0].node.name).toBe("workspace");
    expect(rows[0].depth).toBe(0);
  });

  it("hides children of collapsed folders", () => {
    const files = toMap([
      makeActivity("/workspace/a/b/c.ts"),
      makeActivity("/workspace/a/d.ts"),
    ]);
    const tree = buildFileTree(files, "/workspace");
    // Only expand workspace root, not "a"
    const wsKey = tree[0].fullPath;
    const expanded = new Set([wsKey]);
    const rows = flattenTree(tree, expanded);

    // workspace, a (collapsed), — b and children hidden
    expect(rows).toHaveLength(2);
    expect(rows[0].node.name).toBe("workspace");
    expect(rows[1].node.name).toBe("a");
  });
});

describe("allFolderPaths", () => {
  it("collects all non-file paths", () => {
    const files = toMap([
      makeActivity("/workspace/x/y/z.ts"),
      makeActivity("/workspace/x/w.ts"),
    ]);
    const tree = buildFileTree(files, "/workspace");
    const paths = allFolderPaths(tree);

    // workspace root + x + y
    expect(paths.size).toBe(3);
  });
});
