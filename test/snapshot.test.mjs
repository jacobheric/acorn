import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { snapshot as remote } from "../runner/execute.mjs";
import { snapshot as local } from "../cli/snapshot.ts";

const root = mkdtempSync(join(tmpdir(), "acorn-snapshot-"));
const repo = join(root, "repo");
const git = (...args) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
mkdirSync(join(repo, "test"), { recursive: true });
git("init", "-q");
writeFileSync(join(repo, "test", "security.test.mjs"), "throw new Error()\n");
writeFileSync(join(repo, "version.txt"), "$Format:%s$\n");
writeFileSync(join(repo, "id.txt"), "$Id$\n");
writeFileSync(
  join(repo, ".gitattributes"),
  "test/security.test.mjs export-ignore\nversion.txt export-subst\n* ident eol=crlf\n",
);
git("add", "-A");
git("-c", "user.name=a", "-c", "user.email=a@b", "commit", "-qm", "msg");
const tracked = git("ls-tree", "-r", "HEAD")
  .split("\n")
  .map((line) => line.split(/\s+/));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const extracted = (tar) => {
  const out = mkdtempSync(join(root, "out-"));
  execFileSync("tar", ["-xf", tar, "-C", out]);
  return Object.fromEntries(
    tracked.map(([, , , path]) => {
      try {
        return [path, execFileSync("git", ["hash-object", join(out, path)], { encoding: "utf8" }).trim()];
      } catch {
        return [path, null];
      }
    }),
  );
};
const expected = Object.fromEntries(tracked.map(([, , sha, path]) => [path, sha]));

describe("source snapshots", () => {
  it("tests exactly the tracked tree on the remote runner", async () => {
    const tar = join(root, "remote.tar");
    await remote(join(repo, ".git"), "HEAD", tar);
    expect(extracted(tar)).toEqual(expected);
  });
  it("tests exactly the tracked tree locally without touching the repo", () => {
    const tar = join(root, "local.tar");
    local(repo, git("rev-parse", "HEAD"), tar);
    expect(extracted(tar)).toEqual(expected);
    expect(git("status", "--porcelain")).toBe("");
  });
});
