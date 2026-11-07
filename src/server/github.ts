import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { shaSchema, type Recipe } from "../core/types.ts";

type Commit = {
  sha: string;
  tree: string;
  message: string;
  parents?: string[];
};
const exec = promisify(execFile);
export const resolvePublicGit = async (
  repository: string,
  ref: string,
): Promise<Commit> => {
  const directory = await mkdtemp(join(tmpdir(), "acorn-source-"));
  const git = async (...args: string[]) =>
    (
      await exec("git", args, {
        cwd: directory,
        timeout: 20_000,
        maxBuffer: 1_000_000,
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      })
    ).stdout.trim();
  try {
    await git("init", "--bare", "-q");
    await git(
      "-c",
      "protocol.file.allow=never",
      "fetch",
      "--filter=blob:none",
      "--depth=1",
      `https://github.com/${repository}.git`,
      ref,
    );
    const [sha, tree, message] = (
      await git("show", "--no-patch", "--format=%H%n%T%n%s", "FETCH_HEAD")
    ).split("\n");
    const object = await git("cat-file", "-p", "FETCH_HEAD");
    return {
      sha: shaSchema.parse(sha),
      tree: shaSchema.parse(tree),
      message: (message ?? "").slice(0, 200),
      parents: [...object.matchAll(/^parent ([a-f0-9]{40})$/gm)].map(
        (match) => match[1],
      ),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

export const createGithub = (
  recipe: Recipe,
  token: string,
  request: typeof fetch = fetch,
  gitResolve = resolvePublicGit,
) => {
  const cache = new Map<
    string,
    { sha: string; tree: string; message: string }
  >();
  const resolve = async (ref: string) => {
    if (!shaSchema.safeParse(ref).success && ref !== "main")
      throw new Error("Use main or a full commit SHA");
    const cached = cache.get(ref);
    if (cached) return cached;
    const response = await request(
      `https://api.github.com/repos/${recipe.repository}/commits/${ref}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "acorn-ci",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok && ![403, 429].includes(response.status))
      throw new Error(
        `GitHub returned ${response.status} while resolving the commit`,
      );
    const data = response.ok
      ? ((await response.json()) as {
          sha: string;
          commit: { tree: { sha: string }; message: string };
        })
      : null;
    const result = data
      ? {
          sha: shaSchema.parse(data.sha),
          tree: shaSchema.parse(data.commit.tree.sha),
          message: data.commit.message.split("\n")[0].slice(0, 200),
        }
      : await gitResolve(recipe.repository, ref);
    if (ref !== "main") {
      if (result.sha !== ref)
        throw new Error("GitHub returned a different commit");
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(ref, result);
    }
    return result;
  };
  const pullHead = async (number: number) => {
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error("Invalid pull request");
    return (await gitResolve(recipe.repository, `refs/pull/${number}/head`))
      .sha;
  };
  const mergeCandidate = async (number: number, head: string) => {
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error("Invalid pull request");
    const merged = await gitResolve(
      recipe.repository,
      `refs/pull/${number}/merge`,
    );
    const base = await resolve("main");
    if (
      merged.parents?.length !== 2 ||
      merged.parents[0] !== base.sha ||
      merged.parents[1] !== head
    )
      throw new Error(
        "The proposed merge changed or is not ready. Update the branch and rerun the merge gate.",
      );
    return { ...merged, base: base.sha };
  };
  return { resolve, pullHead, mergeCandidate };
};
