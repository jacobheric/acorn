import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// same override as runner/execute.mjs: in-tree attributes must not change what gets tested
const rawAttributes =
  "* -export-ignore -export-subst -text -eol -ident -filter -working-tree-encoding\n";

export const snapshot = (repo: string, commit: string, output: string) => {
  const gitDir = mkdtempSync(join(tmpdir(), "acorn-git-"));
  try {
    execFileSync("git", ["clone", "-q", "--bare", "--shared", repo, gitDir]);
    mkdirSync(join(gitDir, "info"), { recursive: true });
    writeFileSync(join(gitDir, "info", "attributes"), rawAttributes);
    execFileSync("git", [
      ...["--git-dir", gitDir, "archive", "--format=tar"],
      `--output=${output}`,
      commit,
    ]);
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
};
