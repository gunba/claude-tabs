#!/usr/bin/env python3
"""
Codex hook entrypoint for agent-proofs.

Codex does not have Claude-style path-scoped Markdown auto-load. These hooks
provide the closest native integration point: session-level proofd guidance and
prompt-level targeted context.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
from typing import Any

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
PROOFD_PATH = SCRIPT_DIR / "proofd.py"
MAX_CONTEXT_CHARS = 12000
MAX_CONTEXT_PATHS = 20
PATH_RE = re.compile(r"(?<![\w./~-])(?:\.?\.?/)?[A-Za-z0-9_.@+~-]+(?:/[A-Za-z0-9_.@+~-]+)+(?:\.[A-Za-z0-9_+-]+)?")
PROOF_PROMPT_RE = re.compile(r"\b(proofd|proof|prove|rules?|tags?|review|janitor)\b|(?<!\S)/(?:rj|r|j)(?!\S)", re.IGNORECASE)


def child_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def read_hook_input() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def repo_root_from(path: pathlib.Path) -> pathlib.Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=str(path),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=child_env(),
        check=False,
    )
    if result.returncode == 0 and result.stdout.strip():
        return pathlib.Path(result.stdout.strip()).resolve()
    return path.resolve()


def run_command(repo_root: pathlib.Path, args: list[str], timeout: int = 15) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=child_env(),
        timeout=timeout,
        check=False,
    )


def run_proofd(repo_root: pathlib.Path, args: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return run_command(repo_root, [sys.executable, str(PROOFD_PATH), "--repo-root", str(repo_root), *args], timeout=timeout)


def changed_paths(repo_root: pathlib.Path) -> list[str]:
    result = run_command(repo_root, ["git", "diff", "HEAD", "--name-only"], timeout=10)
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()][:MAX_CONTEXT_PATHS]


def prompt_paths(repo_root: pathlib.Path, prompt: str) -> list[str]:
    found: list[str] = []
    for match in PATH_RE.finditer(prompt):
        candidate = match.group(0).strip("`'\"()[]{}.,:;")
        if not candidate or candidate.startswith("http://") or candidate.startswith("https://"):
            continue
        normalized = candidate[2:] if candidate.startswith("./") else candidate
        path = (repo_root / normalized).resolve()
        try:
            path.relative_to(repo_root)
        except ValueError:
            continue
        if path.exists() and normalized not in found:
            found.append(normalized)
        if len(found) >= MAX_CONTEXT_PATHS:
            break
    return found


def truncate(text: str, limit: int = MAX_CONTEXT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n\n[proofd context truncated]"


def emit_context(event_name: str, context: str) -> None:
    payload = {
        "hookSpecificOutput": {
            "hookEventName": event_name,
            "additionalContext": context,
        }
    }
    print(json.dumps(payload, ensure_ascii=False))


def session_context(repo_root: pathlib.Path) -> str:
    status = run_proofd(repo_root, ["status"], timeout=10)
    status_lines = []
    if status.returncode == 0:
        try:
            payload = json.loads(status.stdout)
            status_lines = [
                f"- repo: {payload.get('repo_key') or payload.get('repo_id')}",
                f"- branch: {payload.get('branch')}",
                f"- overlay rules: {payload.get('overlay_rules')}",
            ]
        except json.JSONDecodeError:
            status_lines = []
    else:
        status_lines = [f"- proofd status unavailable: {(status.stderr or status.stdout).strip()}"]

    lines = [
        "## Agent Proofs",
        "",
        "This repository uses proofd for tagged documentation and proof maintenance.",
        "Codex does not auto-load Claude `.claude/rules/*.md` by touched file path.",
        "",
        "When working on specific files, request scoped proof context with:",
        f"`{sys.executable} {PROOFD_PATH} --repo-root {repo_root} context <paths...>`",
        "",
        "For review or janitor/proving work, start from:",
        f"`{sys.executable} {PROOFD_PATH} --repo-root {repo_root} select-matching <paths...>`",
        "",
        "Use proofd mutation commands for rule changes; never invent tag IDs manually and never hand-edit `.claude/rules/*.md`.",
    ]
    if status_lines:
        lines.extend(["", "Current proofd status:", *status_lines])
    return "\n".join(lines)


def prompt_context(repo_root: pathlib.Path, prompt: str) -> str | None:
    paths = prompt_paths(repo_root, prompt)
    proof_related = bool(PROOF_PROMPT_RE.search(prompt))
    if not paths and proof_related:
        paths = changed_paths(repo_root)
    if not paths:
        return None

    result = run_proofd(repo_root, ["context", *paths], timeout=20)
    if result.returncode != 0 or not result.stdout.strip():
        return "\n".join(
            [
                "## Agent Proofs",
                "",
                f"Relevant paths detected: {', '.join(paths)}",
                "Run proofd context manually if you need tagged documentation context:",
                f"`{sys.executable} {PROOFD_PATH} --repo-root {repo_root} context {' '.join(paths)}`",
            ]
        )
    return "\n".join(["## Agent Proofs Context", "", truncate(result.stdout)])


def main() -> int:
    parser = argparse.ArgumentParser(description="agent-proofs Codex hook")
    parser.add_argument("event", choices=["session-start", "user-prompt-submit"])
    args = parser.parse_args()

    hook_input = read_hook_input()
    cwd = pathlib.Path(str(hook_input.get("cwd") or os.getcwd()))
    repo_root = repo_root_from(cwd)

    if args.event == "session-start":
        emit_context("SessionStart", session_context(repo_root))
        return 0

    prompt = str(hook_input.get("prompt") or "")
    context = prompt_context(repo_root, prompt)
    if context:
        emit_context("UserPromptSubmit", context)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
