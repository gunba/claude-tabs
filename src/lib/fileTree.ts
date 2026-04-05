/**
 * File tree builder for the Activity Panel.
 *
 * Converts a flat set of file paths into a hierarchical tree structure
 * suitable for rendering as a file explorer. Paths within the workspace
 * are shown relative to the workspace root; external paths use minimal
 * absolute structure. Single-child directory chains are compressed.
 */

import type { FileActivity } from "../types/activity";
import { canonicalizePath, parseWorktreePath } from "./paths";

export interface FileTreeNode {
  /** Display name — the last segment (or compressed chain) of this node's path. */
  name: string;
  /** Original full path (as stored in FileActivity.path) for lookups. */
  fullPath: string;
  /** True for leaf file nodes, false for directories. */
  isFile: boolean;
  /** Sorted children: directories first, then case-insensitive alphabetical. */
  children: FileTreeNode[];
  /** Non-null for file (leaf) nodes — the latest activity record. */
  activity: FileActivity | null;
}

/** Intermediate trie node used during tree construction. */
interface TrieNode {
  children: Map<string, TrieNode>;
  /** Set when this node corresponds to an actual visited file. */
  activity: FileActivity | null;
  /** Original full path for file leaves. */
  originalPath: string | null;
}

function newTrieNode(): TrieNode {
  return { children: new Map(), activity: null, originalPath: null };
}

/**
 * Split a forward-slash-normalized path into segments.
 * Handles Windows drive letters (e.g. "C:/Users/...") and Unix absolute paths.
 */
function splitSegments(normalizedPath: string): string[] {
  const trimmed = normalizedPath.replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean);
}

/**
 * Build a file tree from a map of file paths to their latest activity.
 *
 * When `workspaceDir` is provided, paths within the workspace are shown
 * relative to it. External paths use minimal structure. Single-child
 * directory chains are compressed (VSCode "compact folders").
 */
// [AP-02] Workspace-relative tree with external-file grouping and single-child chain compression
export function buildFileTree(
  files: Map<string, FileActivity>,
  workspaceDir: string,
): FileTreeNode[] {
  if (files.size === 0) return [];

  const canonWs = canonicalizePath(workspaceDir);

  // If no workspace dir provided, fall back to absolute path tree
  if (!canonWs) {
    const root = newTrieNode();
    for (const [path, activity] of files) {
      const normalized = canonicalizePath(path);
      const segments = splitSegments(normalized);
      if (segments.length === 0) continue;
      let current = root;
      for (const segment of segments) {
        if (!current.children.has(segment)) {
          current.children.set(segment, newTrieNode());
        }
        current = current.children.get(segment)!;
      }
      current.activity = activity;
      current.originalPath = path;
    }
    return compressTree(trieToNodes(root, ""));
  }

  const wsPrefix = canonWs + "/";

  // Derive workspace display name
  const wt = parseWorktreePath(canonWs);
  const wsName = wt
    ? wt.projectName
    : canonWs.split("/").filter(Boolean).pop() || canonWs;

  // Partition files into workspace-internal and external
  const internalFiles = new Map<string, FileActivity>();
  const externalFiles = new Map<string, FileActivity>();

  for (const [path, activity] of files) {
    const canon = canonicalizePath(path);
    if (canon.startsWith(wsPrefix) || canon === canonWs) {
      internalFiles.set(path, activity);
    } else {
      externalFiles.set(path, activity);
    }
  }

  const roots: FileTreeNode[] = [];

  // Build workspace subtree
  if (internalFiles.size > 0) {
    const wsTrie = newTrieNode();
    for (const [path, activity] of internalFiles) {
      const canon = canonicalizePath(path);
      const relative = canon.startsWith(wsPrefix)
        ? canon.slice(wsPrefix.length)
        : "";
      const segments = splitSegments(relative);
      if (segments.length === 0) continue;

      let current = wsTrie;
      for (const segment of segments) {
        if (!current.children.has(segment)) {
          current.children.set(segment, newTrieNode());
        }
        current = current.children.get(segment)!;
      }
      current.activity = activity;
      current.originalPath = path;
    }

    const wsChildren = trieToNodes(wsTrie, "");
    const wsRoot: FileTreeNode = {
      name: wsName,
      fullPath: `__ws__${canonWs}`,
      isFile: false,
      children: compressTree(wsChildren),
      activity: null,
    };
    roots.push(wsRoot);
  }

  // Build external subtree(s) with minimal prefix
  if (externalFiles.size > 0) {
    const extTrie = newTrieNode();
    const allSegmentArrays: string[][] = [];

    for (const [path, activity] of externalFiles) {
      const canon = canonicalizePath(path);
      const segments = splitSegments(canon);
      if (segments.length === 0) continue;
      allSegmentArrays.push(segments);

      let current = extTrie;
      for (const segment of segments) {
        if (!current.children.has(segment)) {
          current.children.set(segment, newTrieNode());
        }
        current = current.children.get(segment)!;
      }
      current.activity = activity;
      current.originalPath = path;
    }

    // Find longest common prefix among external files to skip it
    const lcp = longestCommonPrefix(allSegmentArrays);
    // Keep at least one segment for root label
    const skipCount = Math.max(0, lcp - 1);

    let trimmedTrie = extTrie;
    const rootLabel: string[] = [];
    for (let i = 0; i < skipCount; i++) {
      const entries = [...trimmedTrie.children.entries()];
      if (entries.length !== 1) break;
      rootLabel.push(entries[0][0]);
      trimmedTrie = entries[0][1];
    }

    const prefixPath = rootLabel.join("/");
    const extNodes = trieToNodes(trimmedTrie, prefixPath);
    const compressed = compressTree(extNodes);

    // When we skipped a common prefix, wrap results in a folder node so the
    // prefix context isn't lost (e.g. "/external/lib" stays visible).
    if (rootLabel.length > 0 && compressed.length > 0) {
      roots.push({
        name: prefixPath,
        fullPath: `__ext__${prefixPath}`,
        isFile: false,
        children: compressed,
        activity: null,
      });
    } else {
      roots.push(...compressed);
    }
  }

  return roots;
}

/** Compute length of the longest common prefix among arrays of segments. */
function longestCommonPrefix(arrays: string[][]): number {
  if (arrays.length === 0) return 0;
  let len = 0;
  const first = arrays[0];
  outer: for (let i = 0; i < first.length; i++) {
    for (let j = 1; j < arrays.length; j++) {
      if (i >= arrays[j].length || arrays[j][i] !== first[i]) break outer;
    }
    len++;
  }
  return len;
}

/** Recursively convert trie children into sorted FileTreeNode arrays. */
function trieToNodes(trie: TrieNode, parentPath: string): FileTreeNode[] {
  const nodes: FileTreeNode[] = [];

  for (const [name, child] of trie.children) {
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    const isFile = child.activity !== null;

    const node: FileTreeNode = {
      name,
      // For files, use the original path for downstream lookups (shell_open, mascot matching).
      // For folders, use the reconstructed forward-slash path.
      fullPath: isFile && child.originalPath ? child.originalPath : fullPath,
      isFile,
      children: isFile ? [] : trieToNodes(child, fullPath),
      activity: child.activity,
    };

    nodes.push(node);
  }

  // Sort: directories first, then case-insensitive alphabetical
  nodes.sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return nodes;
}

/**
 * Compress single-child directory chains (VSCode "compact folders").
 * E.g. src → components → Panel becomes "src/components/Panel".
 */
function compressTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.isFile) return node;

    // Recurse first so children are already compressed
    const compressed = compressTree(node.children);

    // If this directory has exactly one child and it's also a directory,
    // merge them into a single node
    if (compressed.length === 1 && !compressed[0].isFile) {
      const child = compressed[0];
      return {
        name: `${node.name}/${child.name}`,
        fullPath: child.fullPath,
        isFile: false,
        children: child.children,
        activity: null,
      };
    }

    return { ...node, children: compressed };
  });
}

/**
 * Flatten a tree into a depth-annotated list for rendering.
 * Only includes nodes whose ancestors are all expanded.
 */
export interface FlatTreeRow {
  node: FileTreeNode;
  depth: number;
  /** Unique key for React rendering. */
  key: string;
}

export function flattenTree(
  roots: FileTreeNode[],
  expandedPaths: Set<string>,
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];

  function walk(nodes: FileTreeNode[], depth: number) {
    for (const node of nodes) {
      rows.push({ node, depth, key: node.fullPath });
      if (!node.isFile && expandedPaths.has(node.fullPath)) {
        walk(node.children, depth + 1);
      }
    }
  }

  walk(roots, 0);
  return rows;
}

/**
 * Collect all folder paths in a tree (for default-expand-all behavior).
 */
export function allFolderPaths(roots: FileTreeNode[]): Set<string> {
  const paths = new Set<string>();

  function walk(nodes: FileTreeNode[]) {
    for (const node of nodes) {
      if (!node.isFile) {
        paths.add(node.fullPath);
        walk(node.children);
      }
    }
  }

  walk(roots);
  return paths;
}
