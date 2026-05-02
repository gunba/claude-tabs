import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const PYTHON = process.env.PYTHON ?? "python";
const REPO_ROOT = process.cwd();

function runUserPromptHook(prompt) {
  const result = spawnSync(PYTHON, ["tools/codex_hook.py", "user-prompt-submit"], {
    cwd: REPO_ROOT,
    input: JSON.stringify({ cwd: REPO_ROOT, prompt }),
    encoding: "utf8",
  });

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}

describe("codex proofd hook", () => {
  it("does not inject context for review or janitor prompts without concrete paths", () => {
    for (const prompt of [
      "/r",
      "/j",
      "/rj",
      "review and commit",
      "run proof",
      "janitor pass please",
    ]) {
      expect(runUserPromptHook(prompt)).toBe("");
    }
  });

  it("injects scoped context when the prompt names an existing repo path", () => {
    const raw = runUserPromptHook("Review tools/codex_hook.py");
    const payload = JSON.parse(raw);

    expect(payload.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(payload.hookSpecificOutput.additionalContext).toContain("## Agent Proofs Context");
    expect(payload.hookSpecificOutput.additionalContext).toContain("tools/codex_hook.py");
  });

  it("injects scoped context when the prompt names an existing root-level repo file", () => {
    for (const path of [
      "AGENTS.md",
      "package.json",
      "./AGENTS.md",
      "./package.json",
      "AGENTS.md.",
      "package.json.",
      "./AGENTS.md.",
      "./package.json.",
    ]) {
      const raw = runUserPromptHook(`Review ${path}`);
      const payload = JSON.parse(raw);
      const normalizedPath = path.replace(/^\.\//, "").replace(/\.$/, "");

      expect(payload.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
      expect(payload.hookSpecificOutput.additionalContext).toContain("## Agent Proofs Context");
      expect(payload.hookSpecificOutput.additionalContext).toContain(normalizedPath);
    }
  }, 15000);

  it("ignores URLs and paths outside the repo", () => {
    expect(runUserPromptHook("Review https://example.com/tools/codex_hook.py and ../AGENTS.md")).toBe("");
  });
});
