// Shared process-tree helpers used by both the Linux (ptrace) and Windows
// (DebugActiveProcess) tracers.
//
// The platform backends each build the node map differently — Linux reads
// /proc, Windows uses Toolhelp32 and DEBUG_EVENT payloads — but once the
// map exists the ancestry walk is identical.
use std::collections::HashMap;

use super::event::ProcessInfo;

#[derive(Clone, Debug)]
pub(crate) struct ProcessNode {
    pub pid: u32,
    pub ppid: u32,
    pub exe: String,
    pub argv: Vec<String>,
}

impl ProcessNode {
    pub(crate) fn to_info(&self) -> ProcessInfo {
        ProcessInfo {
            pid: self.pid,
            exe: self.exe.clone(),
            argv: self.argv.clone(),
        }
    }
}

/// Walk the (pid → ProcessNode) map from `pid` up to (but excluding)
/// `root_pid`, oldest-first. Bounded by a 32-step guard to tolerate
/// malformed ppid chains.
pub(crate) fn build_chain(
    pid: u32,
    root_pid: u32,
    nodes: &HashMap<u32, ProcessNode>,
) -> Vec<ProcessInfo> {
    let mut chain = Vec::new();
    let mut cur = pid;
    let mut guard = 0;
    while cur != root_pid && guard < 32 {
        guard += 1;
        match nodes.get(&cur) {
            Some(n) => {
                chain.push(n.to_info());
                if n.ppid == 0 || n.ppid == cur {
                    break;
                }
                cur = n.ppid;
            }
            None => break,
        }
    }
    chain
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(pid: u32, ppid: u32, exe: &str) -> ProcessNode {
        ProcessNode {
            pid,
            ppid,
            exe: exe.to_string(),
            argv: Vec::new(),
        }
    }

    #[test]
    fn build_chain_from_grandchild_to_root() {
        let mut nodes = HashMap::new();
        nodes.insert(10, node(10, 0, "/bash")); // root
        nodes.insert(20, node(20, 10, "/python"));
        nodes.insert(30, node(30, 20, "/ripgrep"));

        let chain = build_chain(30, 10, &nodes);
        let exes: Vec<_> = chain.iter().map(|p| p.exe.as_str()).collect();
        assert_eq!(exes, vec!["/ripgrep", "/python"]);
    }

    #[test]
    fn build_chain_stops_at_self_cycle() {
        // A malformed ppid that points back at the node itself must
        // not loop forever.
        let mut nodes = HashMap::new();
        nodes.insert(5, node(5, 5, "/self-loop"));

        let chain = build_chain(5, 0, &nodes);
        assert_eq!(chain.len(), 1);
        assert_eq!(chain[0].exe, "/self-loop");
    }

    #[test]
    fn build_chain_stops_on_ppid_zero() {
        let mut nodes = HashMap::new();
        nodes.insert(5, node(5, 0, "/orphan"));

        let chain = build_chain(5, 99, &nodes);
        assert_eq!(chain.len(), 1);
    }

    #[test]
    fn build_chain_guard_bounds_long_cycles() {
        // Two-node cycle where neither is root_pid; guard must cap the walk.
        let mut nodes = HashMap::new();
        nodes.insert(1, node(1, 2, "/a"));
        nodes.insert(2, node(2, 1, "/b"));

        let chain = build_chain(1, 99, &nodes);
        assert!(chain.len() <= 32);
    }

    #[test]
    fn build_chain_excludes_root() {
        let mut nodes = HashMap::new();
        nodes.insert(10, node(10, 0, "/root"));
        nodes.insert(20, node(20, 10, "/child"));

        let chain = build_chain(20, 10, &nodes);
        assert_eq!(chain.len(), 1);
        assert_eq!(chain[0].pid, 20);
    }
}
