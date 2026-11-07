import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const runAction = async (
  env = process.env,
  request = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) => {
  const {
    ACORN_URL,
    ACORN_COMMIT,
    ACORN_MODE = "fallback",
    ACORN_TOKEN,
    ACORN_PULL_REQUEST,
    ACORN_MERGE_GATE = "true",
    ACORN_WAIT_FOR_MERGE = "false",
    GH_TOKEN,
    GITHUB_REPOSITORY,
    GITHUB_STEP_SUMMARY,
  } = env;
  if (!ACORN_URL || new URL(ACORN_URL).protocol !== "https:")
    throw new Error("Set a HTTPS Acorn URL");
  if (!/^[a-f0-9]{40}$/.test(ACORN_COMMIT ?? ""))
    throw new Error("Provide a full commit SHA");
  if (!["verify", "fallback", "firewall"].includes(ACORN_MODE))
    throw new Error("Unknown mode");
  if (
    !["true", "false"].includes(ACORN_MERGE_GATE) ||
    !["true", "false"].includes(ACORN_WAIT_FOR_MERGE)
  )
    throw new Error("merge-gate and wait-for-merge must be true or false");
  const pullRequest = ACORN_PULL_REQUEST
    ? Number(ACORN_PULL_REQUEST)
    : undefined;
  if (
    pullRequest !== undefined &&
    (!Number.isSafeInteger(pullRequest) || pullRequest < 1)
  )
    throw new Error("Invalid pull request number");
  const automaticGate =
    ACORN_MODE === "firewall" && ACORN_WAIT_FOR_MERGE === "true";
  if (automaticGate && !pullRequest)
    throw new Error("Automatic merge gates require a pull request number");
  const base = ACORN_URL.replace(/\/$/, "");
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
  const acorn = (path, body) =>
    json(`${base}/api${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(body && ACORN_TOKEN
          ? { Authorization: `Bearer ${ACORN_TOKEN}` }
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
  const name = ACORN_MODE === "firewall" ? "Acorn / merge gate" : "Acorn / CI";
  const pending =
    ACORN_MODE === "firewall"
      ? (
          await github(
            `/commits/${ACORN_COMMIT}/check-runs?check_name=${encodeURIComponent(name)}&status=queued&filter=all&per_page=100`,
          )
        ).check_runs.find(
          (candidate) =>
            candidate.app?.slug === "github-actions" &&
            candidate.details_url === base,
        )
      : undefined;
  const check =
    pending ??
    (await github("/check-runs", {
      name,
      head_sha: ACORN_COMMIT,
      status: automaticGate ? "queued" : "in_progress",
      details_url: base,
    }));
  if (pending && !automaticGate)
    await github(`/check-runs/${check.id}`, { status: "in_progress" }, "PATCH");
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
      "This workflow was cancelled. Acorn stops superseded PR runners independently.",
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
        pr.head.sha !== ACORN_COMMIT ||
        (run?.pullRequest?.base && pr.base.sha !== run.pullRequest.base)
      )
        throw new Error(
          "The pull request changed or closed. This result is superseded.",
        );
      if (automaticGate && run && !pr.auto_merge)
        throw new Error(
          "The merge request was withdrawn. This run is superseded.",
        );
      return pr;
    };
    const pr = await assertCurrent();
    if (ACORN_MODE === "firewall" && ACORN_MERGE_GATE === "false") {
      await writeCheck(
        "skipped",
        "Merge gate disabled",
        "The repository has opted out of fresh pre-merge CI. The regular Acorn / CI check still applies.",
      );
      return;
    }
    if (automaticGate && !pr.auto_merge) {
      await github(
        `/check-runs/${check.id}`,
        {
          status: "queued",
          output: {
            title: "Waiting for a merge request",
            summary:
              "Enable auto-merge on this PR to start fresh CI. GitHub will merge it after all required checks and reviews pass.",
          },
        },
        "PATCH",
      );
      return;
    }
    if (automaticGate)
      await github(`/check-runs/${check.id}`, { status: "in_progress" }, "PATCH");
    let verification;
    if (ACORN_MODE === "verify") {
      verification = await acorn(`/verify?commit=${ACORN_COMMIT}`);
    } else {
      if (!ACORN_TOKEN) throw new Error("Set ACORN_AUTOMATION_TOKEN");
      const started = await acorn("/runs", {
        commit: ACORN_COMMIT,
        reason: ACORN_MODE,
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
          run = await acorn(`/runs/${run.id}`);
        }
        if (run.status !== "passed")
          throw new Error(
            `CI ${run.status}: ${run.error ?? run.cleanupError ?? "No passing result"}`,
          );
        verification = await acorn(
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
      ACORN_MODE === "firewall"
        ? "Full CI passed before merge"
        : run
          ? "Remote CI passed"
          : "Trusted receipt reused";
    const summary = [
      `**${title}.**`,
      "",
      `- PR commit: \`${ACORN_COMMIT}\``,
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
      `[Inspect the result in Acorn](${base})`,
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
      `${error.message}\n\n[Inspect the result in Acorn](${base})`,
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
