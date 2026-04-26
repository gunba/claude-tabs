import { describe, it, expect } from "vitest";
import { parseBashFiles } from "../bashFileParser";

const CWD = "/home/u/proj";

describe("parseBashFiles", () => {
  it("returns [] for empty command", () => {
    expect(parseBashFiles("", CWD)).toEqual([]);
  });

  it("parses rm with single file", () => {
    expect(parseBashFiles("rm foo.txt", CWD)).toEqual([
      { path: "/home/u/proj/foo.txt", kind: "deleted" },
    ]);
  });

  it("parses rm -rf with flag and dir", () => {
    expect(parseBashFiles("rm -rf node_modules", CWD)).toEqual([
      { path: "/home/u/proj/node_modules", kind: "deleted" },
    ]);
  });

  it("parses rm with quoted path containing spaces", () => {
    expect(parseBashFiles('rm "my file.txt"', CWD)).toEqual([
      { path: "/home/u/proj/my file.txt", kind: "deleted" },
    ]);
  });

  it("parses rm with multiple args", () => {
    expect(parseBashFiles("rm a.txt b.txt c.txt", CWD)).toEqual([
      { path: "/home/u/proj/a.txt", kind: "deleted" },
      { path: "/home/u/proj/b.txt", kind: "deleted" },
      { path: "/home/u/proj/c.txt", kind: "deleted" },
    ]);
  });

  it("parses mv as deleted+created", () => {
    expect(parseBashFiles("mv a.txt b.txt", CWD)).toEqual([
      { path: "/home/u/proj/a.txt", kind: "deleted" },
      { path: "/home/u/proj/b.txt", kind: "created" },
    ]);
  });

  it("parses cp as created on dst only", () => {
    expect(parseBashFiles("cp src.ts dst.ts", CWD)).toEqual([
      { path: "/home/u/proj/dst.ts", kind: "created" },
    ]);
  });

  it("parses touch as created", () => {
    expect(parseBashFiles("touch new.txt", CWD)).toEqual([
      { path: "/home/u/proj/new.txt", kind: "created" },
    ]);
  });

  it("parses mkdir as folder created", () => {
    expect(parseBashFiles("mkdir -p out/dist", CWD)).toEqual([
      { path: "/home/u/proj/out/dist", kind: "created", isFolder: true },
    ]);
  });

  it("parses rmdir as folder deleted", () => {
    expect(parseBashFiles("rmdir old", CWD)).toEqual([
      { path: "/home/u/proj/old", kind: "deleted", isFolder: true },
    ]);
  });

  it("parses > redirect as created", () => {
    expect(parseBashFiles("echo hi > out.txt", CWD)).toEqual([
      { path: "/home/u/proj/out.txt", kind: "created" },
    ]);
  });

  it("parses >> redirect as modified", () => {
    expect(parseBashFiles("echo hi >> log.txt", CWD)).toEqual([
      { path: "/home/u/proj/log.txt", kind: "modified" },
    ]);
  });

  it("parses tee as created", () => {
    expect(parseBashFiles("echo hi | tee out.txt", CWD)).toEqual([
      { path: "/home/u/proj/out.txt", kind: "created" },
    ]);
  });

  it("parses tee -a as modified", () => {
    expect(parseBashFiles("echo hi | tee -a log.txt", CWD)).toEqual([
      { path: "/home/u/proj/log.txt", kind: "modified" },
    ]);
  });

  it("splits on && into multiple statements", () => {
    expect(parseBashFiles("touch a.txt && rm b.txt", CWD)).toEqual([
      { path: "/home/u/proj/a.txt", kind: "created" },
      { path: "/home/u/proj/b.txt", kind: "deleted" },
    ]);
  });

  it("splits on ; into multiple statements", () => {
    expect(parseBashFiles("touch a; touch b", CWD)).toEqual([
      { path: "/home/u/proj/a", kind: "created" },
      { path: "/home/u/proj/b", kind: "created" },
    ]);
  });

  it("preserves absolute paths", () => {
    expect(parseBashFiles("rm /tmp/abs.txt", CWD)).toEqual([
      { path: "/tmp/abs.txt", kind: "deleted" },
    ]);
  });

  it("strips ./ prefix on relative paths", () => {
    expect(parseBashFiles("rm ./local.txt", CWD)).toEqual([
      { path: "/home/u/proj/local.txt", kind: "deleted" },
    ]);
  });

  it("tracks cat as a read", () => {
    expect(parseBashFiles("cat foo.txt", CWD)).toEqual([
      { path: "/home/u/proj/foo.txt", kind: "read" },
    ]);
  });

  it("tracks sed ranges as reads", () => {
    expect(parseBashFiles("sed -n '1,20p' src/App.tsx", CWD)).toEqual([
      { path: "/home/u/proj/src/App.tsx", kind: "read" },
    ]);
  });

  it("tracks grep file targets as searches", () => {
    expect(parseBashFiles("grep foo bar.txt", CWD)).toEqual([
      { path: "/home/u/proj/bar.txt", kind: "searched", isFolder: false },
    ]);
  });

  it("tracks rg roots as searches", () => {
    expect(parseBashFiles("rg SkillInvocation src", CWD)).toEqual([
      { path: "/home/u/proj/src", kind: "searched", isFolder: true },
    ]);
  });

  it("tracks rg --files roots as searches", () => {
    expect(parseBashFiles("rg --files -g '*.ts' src", CWD)).toEqual([
      { path: "/home/u/proj/src", kind: "searched", isFolder: true },
    ]);
  });

  it("tracks ls and find roots as searches", () => {
    expect(parseBashFiles("ls -la /tmp", CWD)).toEqual([
      { path: "/tmp", kind: "searched", isFolder: true },
    ]);
    expect(parseBashFiles("find . -name '*.ts'", CWD)).toEqual([
      { path: "/home/u/proj", kind: "searched", isFolder: true },
    ]);
  });

  it("tracks input redirection as a read", () => {
    expect(parseBashFiles("sort < in.txt > out.txt", CWD)).toEqual([
      { path: "/home/u/proj/in.txt", kind: "read" },
      { path: "/home/u/proj/out.txt", kind: "created" },
    ]);
  });

  it("ignores git commands (covered by git_list_changes)", () => {
    expect(parseBashFiles("git rm foo.txt", CWD)).toEqual([]);
    expect(parseBashFiles("git mv a b", CWD)).toEqual([]);
  });

  it("skips glob patterns rather than emitting literal *", () => {
    expect(parseBashFiles("rm *.tmp", CWD)).toEqual([]);
  });

  it("handles sudo prefix", () => {
    expect(parseBashFiles("sudo rm /etc/foo", CWD)).toEqual([
      { path: "/etc/foo", kind: "deleted" },
    ]);
  });

  it("handles env-var-prefixed command", () => {
    expect(parseBashFiles("FOO=bar touch x.txt", CWD)).toEqual([
      { path: "/home/u/proj/x.txt", kind: "created" },
    ]);
  });

  it("handles compound: write then delete same file", () => {
    expect(parseBashFiles("echo hi > tmp.txt && rm tmp.txt", CWD)).toEqual([
      { path: "/home/u/proj/tmp.txt", kind: "created" },
      { path: "/home/u/proj/tmp.txt", kind: "deleted" },
    ]);
  });

  it("returns [] on empty cwd with relative path (still emits canonicalized form)", () => {
    expect(parseBashFiles("rm foo.txt", "")).toEqual([
      { path: "foo.txt", kind: "deleted" },
    ]);
  });

  it("does not throw on malformed input", () => {
    expect(() => parseBashFiles('rm "unclosed', CWD)).not.toThrow();
  });

  it("ignores mkdir with no args", () => {
    expect(parseBashFiles("mkdir", CWD)).toEqual([]);
  });

  it("ignores mv with single arg", () => {
    expect(parseBashFiles("mv only-one", CWD)).toEqual([]);
  });

  it("handles cp -r src dst", () => {
    expect(parseBashFiles("cp -r src dst", CWD)).toEqual([
      { path: "/home/u/proj/dst", kind: "created" },
    ]);
  });

  it("handles ln -s target link", () => {
    expect(parseBashFiles("ln -s /etc/hosts hosts-link", CWD)).toEqual([
      { path: "/home/u/proj/hosts-link", kind: "created" },
    ]);
  });

  it("handles redirect with no command (just > file)", () => {
    expect(parseBashFiles("> out.txt", CWD)).toEqual([
      { path: "/home/u/proj/out.txt", kind: "created" },
    ]);
  });
});
