import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  digest,
  keyId,
  objectDigest,
  signReceipt,
} from "../src/core/receipts.ts";
import { recipeSchema, receiptSchema } from "../src/core/types.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: "string" },
    repo: { type: "string" },
    key: { type: "string" },
    out: { type: "string" },
    label: { type: "string" },
  },
});
const command = positionals[0];
const server = (
  values.server ??
  process.env.ACORN_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");
if (
  new URL(server).protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(new URL(server).hostname)
)
  throw new Error("Use HTTPS for a remote coordinator");
const keyPath = resolve(
  values.key ?? join(homedir(), ".config", "acorn", "key.pem"),
);
const request = async (path: string, body?: unknown, authenticated = false) => {
  const token = process.env.ACORN_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN;
  if (authenticated && !token)
    throw new Error("Set ACORN_ADMIN_TOKEN to register a signer");
  const response = await fetch(`${server}/api${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
};
const git = (args: string[], cwd: string) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

if (command === "keygen") {
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
  await writeFile(keyPath, keys.privateKey, { mode: 0o600, flag: "wx" });
  await writeFile(`${keyPath}.pub`, keys.publicKey, {
    mode: 0o644,
    flag: "wx",
  });
  console.log(
    `Key saved to ${keyPath}\nPublic key fingerprint: ${keyId(keys.publicKey)}`,
  );
} else if (command === "register") {
  const publicKey = await readFile(`${keyPath}.pub`, "utf8");
  const signer = await request(
    "/signers",
    { label: values.label ?? "My laptop", publicKey },
    true,
  );
  console.log(`Registered ${signer.label}: ${signer.id}`);
} else if (command === "run") {
  const repo = resolve(values.repo ?? ".");
  if (git(["status", "--porcelain", "--untracked-files=all"], repo))
    throw new Error(
      "Commit or stash your changes first. Acorn tests an exact committed snapshot.",
    );
  if (
    git(["ls-tree", "-r", "HEAD"], repo)
      .split("\n")
      .some((line) => line.startsWith("160000 "))
  )
    throw new Error("Submodules are not supported");
  const commit = git(["rev-parse", "HEAD"], repo);
  const tree = git(["rev-parse", "HEAD^{tree}"], repo);
  const { recipe: raw, digest: expectedDigest } = await request("/recipe");
  const recipe = recipeSchema.parse(raw);
  if (objectDigest(recipe) !== expectedDigest)
    throw new Error("Recipe digest does not match");
  const origin = git(["remote", "get-url", "origin"], repo).replace(
    /\.git$/,
    "",
  );
  if (
    origin !== `https://github.com/${recipe.repository}` &&
    origin !== `git@github.com:${recipe.repository}`
  )
    throw new Error(`This coordinator only accepts ${recipe.repository}`);
  const privateKey = await readFile(keyPath, "utf8");
  const publicKey = await readFile(`${keyPath}.pub`, "utf8");
  const temp = await mkdtemp(join(tmpdir(), "acorn-local-"));
  const containerName = `acorn-local-${process.pid}`;
  const startedAt = new Date().toISOString();
  try {
    git(
      [
        "archive",
        "--format=tar",
        `--output=${join(temp, "source.tar")}`,
        commit,
      ],
      repo,
    );
    const code = await readFile(
      new URL("../runner/execute.mjs", import.meta.url),
      "utf8",
    );
    await writeFile(
      join(temp, "local.mjs"),
      `${code}\nconst result = await execute(${JSON.stringify({ recipe, commit, tree, archive: "/input/source.tar" })});\nprocess.stdout.write(result.output); process.exitCode = result.exitCode;\n`,
    );
    await chmod(temp, 0o755);
    console.log(
      `Running ${recipe.command.join(" ")} in ${recipe.platform}\nTree: ${tree}\nRecipe: ${expectedDigest}`,
    );
    let logs = "";
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      const child = spawn(
        "docker",
        [
          "run",
          "--rm",
          "--name",
          containerName,
          "--platform",
          recipe.platform,
          "--cpus=2",
          "--memory=1g",
          "--pids-limit=256",
          "--cap-drop=ALL",
          "--cap-add=CHOWN",
          "--cap-add=SETUID",
          "--cap-add=SETGID",
          "--security-opt=no-new-privileges",
          "-v",
          `${temp}:/input:ro`,
          recipe.image,
          "node",
          "/input/local.mjs",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.on("data", (chunk) => {
        logs = (logs + chunk.toString()).slice(-100_000);
        process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => process.stderr.write(chunk));
      const timeout = setTimeout(
        () => {
          spawn("docker", ["rm", "-f", containerName], { stdio: "ignore" });
        },
        (recipe.timeoutSeconds + 300) * 1_000,
      );
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveExit(code ?? 1);
      });
    });
    if (exitCode !== 0)
      throw new Error(`CI failed (${exitCode}). No receipt was signed.`);
    const receipt = signReceipt(
      {
        version: 1,
        repository: recipe.repository,
        commit,
        tree,
        recipeDigest: expectedDigest,
        signerId: keyId(publicKey),
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        logDigest: digest(logs),
      },
      privateKey,
    );
    const output = resolve(
      values.out ?? join(tmpdir(), `acorn-${commit.slice(0, 12)}.json`),
    );
    await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      `\nSigned receipt: ${output}\nPublish before pushing: npm run acorn -- publish ${output} --server ${server}`,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
} else if (command === "publish") {
  if (!positionals[1]) throw new Error("Provide a receipt file");
  const receipt = receiptSchema.parse(
    JSON.parse(await readFile(resolve(positionals[1]), "utf8")),
  );
  const stored = await request("/receipts", receipt);
  console.log(`Receipt accepted: ${stored.id}\n${server}`);
} else {
  console.log(
    'Acorn\n\n  keygen    [--key path]\n  register  --label "My laptop" [--key path]\n  run       --repo path [--key path] [--out path]\n  publish   receipt.json\n\nAll commands accept --server URL. Registration reads ACORN_ADMIN_TOKEN.',
  );
}
