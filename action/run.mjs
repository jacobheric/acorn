import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const runAction = async (
  env = process.env,
  request = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) => {
  const {
    RELAY_URL,
    RELAY_COMMIT,
    RELAY_MODE = "fallback",
    RELAY_TOKEN,
    RELAY_PULL_REQUEST,
    GH_TOKEN,
    GITHUB_REPOSITORY,
    GITHUB_STEP_SUMMARY,
  } = env;
  if (!RELAY_URL || new URL(RELAY_URL).protocol !== "https:")
    throw new Error("Set a HTTPS Relay URL");
  if (!/^[a-f0-9]{40}$/.test(RELAY_COMMIT ?? ""))
    throw new Error("Provide a full commit SHA");
  if (!["verify", "fallback", "firewall"].includes(RELAY_MODE))
    throw new Error("Unknown mode");
  const pullRequest = RELAY_PULL_REQUEST
    ? Number(RELAY_PULL_REQUEST)
    : undefined;
  if (
    pullRequest !== undefined &&
    (!Number.isSafeInteger(pullRequest) || pullRequest < 1)
  )
    throw new Error("Invalid pull request number");
  const base = RELAY_URL.replace(/\/$/, "");
  const json = async (url, options) => {
    const response = await request(url, {
      ...options,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? data.message ?? `HTTP ${response.status}`);
    return data;
  };
  const relay = (path, body) =>
    json(`${base}/api${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(body && RELAY_TOKEN
          ? { Authorization: `Bearer ${RELAY_TOKEN}` }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const github = (path, body, method = body ? "POST" : "GET") =>
    json(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const check = await github("/check-runs", {
    name: RELAY_MODE === "firewall" ? "Relay / merge gate" : "Relay / CI",
    head_sha: RELAY_COMMIT,
    status: "in_progress",
    details_url: base,
  });
  let run;
  const writeCheck = async (conclusion, title, summary) => {
    const output = run?.logs
      ? `${summary}\n\n### Test output\n\n<pre>${run.logs.slice(-8_000).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`
      : summary;
    await github(
      `/check-runs/${check.id}`,
      {
        status: "completed",
        conclusion,
        completed_at: new Date().toISOString(),
        output: { title, summary: output },
      },
      "PATCH",
    );
    if (GITHUB_STEP_SUMMARY)
      await appendFile(GITHUB_STEP_SUMMARY, output + "\n");
  };
  const cancelled = () => {
    void writeCheck(
      "cancelled",
      "Superseded or cancelled",
      "This workflow was cancelled. Relay stops superseded PR runners independently.",
    ).finally(() => process.exit(130));
  };
  process.once("SIGINT", cancelled);
  process.once("SIGTERM", cancelled);
  try {
    const assertCurrent = async () => {
      if (!pullRequest) return;
      const pr = await github(`/pulls/${pullRequest}`);
      if (
        pr.state !== "open" ||
        pr.head.sha !== RELAY_COMMIT ||
        (run?.pullRequest?.base && pr.base.sha !== run.pullRequest.base)
      )
        throw new Error(
          "The pull request changed or closed. This result is superseded.",
        );
    };
    await assertCurrent();
    let verification;
    if (RELAY_MODE === "verify") {
      verification = await relay(`/verify?commit=${RELAY_COMMIT}`);
    } else {
      if (!RELAY_TOKEN) throw new Error("Set RELAY_AUTOMATION_TOKEN");
      const started = await relay("/runs", {
        commit: RELAY_COMMIT,
        reason: RELAY_MODE,
        ...(pullRequest ? { pullRequest } : {}),
      });
      if (started.reused) verification = started.verification;
      else {
        run = started.run;
        const deadline = Date.now() + 20 * 60_000;
        while (
          ["queued", "starting", "running", "stopping"].includes(run.status) &&
          Date.now() < deadline
        ) {
          await wait(5_000);
          run = await relay(`/runs/${run.id}`);
        }
        if (run.status !== "passed")
          throw new Error(
            `CI ${run.status}: ${run.error ?? run.cleanupError ?? "No passing result"}`,
          );
        verification = await relay(
          `/verify?commit=${run.commit}&receipt=${run.receiptId}`,
        );
        if (verification.receipt?.runId !== run.id)
          throw new Error("CI did not produce its own verified receipt");
      }
    }
    if (!verification?.verified)
      throw new Error(verification?.reason ?? "No trusted receipt");
    await assertCurrent();
    const title =
      RELAY_MODE === "firewall"
        ? "Full CI passed before merge"
        : run
          ? "Remote CI passed"
          : "Trusted receipt reused";
    const summary = [
      `**${title}.**`,
      "",
      `- PR commit: \`${RELAY_COMMIT}\``,
      `- Tested commit: \`${verification.commit}\``,
      `- Source tree: \`${verification.tree}\``,
      `- Recipe: \`${verification.recipeDigest}\``,
      `- Receipt: \`${verification.receipt.id}\``,
      `- Signer: ${verification.signer.source} / \`${verification.signer.id}\``,
      ...(run?.pullRequest?.base
        ? [`- Target branch: \`${run.pullRequest.base}\``]
        : []),
      ...(run
        ? [`- Container: ${run.cleanupAt ? "removed" : "cleanup pending"}`]
        : []),
      "",
      `[Inspect the result in Relay](${base})`,
    ].join("\n");
    await writeCheck("success", title, summary);
    console.log(title);
  } catch (error) {
    const superseded =
      run?.outcome === "cancelled" ||
      /superseded|no longer the PR head/i.test(error.message);
    await writeCheck(
      superseded ? "cancelled" : "failure",
      superseded ? "Superseded by a newer change" : "CI did not pass",
      `${error.message}\n\n[Inspect the result in Relay](${base})`,
    );
    throw error;
  } finally {
    process.removeListener("SIGINT", cancelled);
    process.removeListener("SIGTERM", cancelled);
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runAction();
}
