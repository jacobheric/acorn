import { shaSchema, type Recipe } from "../core/types.ts";

export const createGithub = (
  recipe: Recipe,
  token: string,
  request: typeof fetch = fetch,
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
          "User-Agent": "relay-ci",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new Error(
        `GitHub returned ${response.status} while resolving the commit`,
      );
    const data = (await response.json()) as {
      sha: string;
      commit: { tree: { sha: string }; message: string };
    };
    const result = {
      sha: shaSchema.parse(data.sha),
      tree: shaSchema.parse(data.commit.tree.sha),
      message: data.commit.message.split("\n")[0].slice(0, 200),
    };
    if (ref !== "main") {
      if (result.sha !== ref)
        throw new Error("GitHub returned a different commit");
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(ref, result);
    }
    return result;
  };
  return { resolve };
};
