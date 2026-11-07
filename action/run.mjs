import { appendFile } from "node:fs/promises";

const {
  RELAY_URL,
  RELAY_COMMIT,
  RELAY_MODE = "verify",
  RELAY_TOKEN,
  GH_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_STEP_SUMMARY,
} = process.env;
if (!RELAY_URL || new URL(RELAY_URL).protocol !== "https:")
  throw new Error("Set a HTTPS Relay URL");
if (!/^[a-f0-9]{40}$/.test(RELAY_COMMIT ?? ""))
  throw new Error("Provide a full commit SHA");
if (!["verify", "fallback", "firewall"].includes(RELAY_MODE))
  throw new Error("Unknown mode");
const base = RELAY_URL.replace(/\/$/, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = async (path, body) => {
  const response = await fetch(`${base}/api${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(body && RELAY_TOKEN
        ? { Authorization: `Bearer ${RELAY_TOKEN}` }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? `Relay returned HTTP ${response.status}`);
  return data;
};
const github = async (path, body, method = "POST") => {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new Error(`GitHub check API returned HTTP ${response.status}`);
  return response.json();
};
const check = await github("/check-runs", {
  name:
    RELAY_MODE === "firewall"
      ? "Relay / merge firewall"
      : "Relay / trusted receipt",
  head_sha: RELAY_COMMIT,
  status: "in_progress",
  details_url: base,
});
try {
  let verification;
  let run;
  if (RELAY_MODE === "verify") {
    for (let attempt = 0; attempt < 7; attempt++) {
      verification = await request(`/verify?commit=${RELAY_COMMIT}`);
      if (verification.verified) break;
      if (attempt < 6) await sleep(10_000);
    }
  } else {
    if (!RELAY_TOKEN)
      throw new Error("Set the RELAY_AUTOMATION_TOKEN repository secret");
    const started = await request("/runs", {
      commit: RELAY_COMMIT,
      reason: RELAY_MODE,
    });
    if (started.reused) verification = started.verification;
    else {
      const deadline = Date.now() + 12 * 60_000;
      while (Date.now() < deadline) {
        run = await request(`/runs/${started.run.id}`);
        if (!["queued", "starting", "running", "stopping"].includes(run.status))
          break;
        await sleep(8_000);
      }
      if (run.status !== "passed")
        throw new Error(
          `Railway run ${run.status}: ${run.error ?? run.cleanupError ?? "No passing result"}`,
        );
      verification = await request(`/verify?commit=${RELAY_COMMIT}`);
      if (RELAY_MODE === "firewall" && verification.receipt?.runId !== run.id)
        throw new Error("The firewall did not produce its own fresh receipt");
    }
  }
  if (!verification?.verified)
    throw new Error(
      `${verification?.reason ?? "No trusted receipt"}. Publish a local receipt or use the Run on Railway workflow, then rerun this check.`,
    );
  const lines = [
    "## Relay CI",
    "",
    `**${RELAY_MODE === "firewall" ? "Fresh merge run passed." : verification.reused ? "Trusted result reused across commits." : "Trusted CI receipt verified."}**`,
    "",
    `- Commit: \`${verification.commit}\``,
    `- Source tree: \`${verification.tree}\``,
    `- Recipe: \`${verification.recipeDigest}\``,
    `- Signer: \`${verification.signer.id}\` (${verification.signer.source})`,
    `- Receipt: \`${verification.receipt.id}\``,
    `- Completed: ${verification.receipt.claim.finishedAt}`,
    ...(run
      ? [`- Container: ${run.cleanupAt ? "removed" : "cleanup pending"}`]
      : []),
    "",
    `[Inspect the receipt and runner](${base})`,
    "",
    "A signature identifies the trusted signer. It is not a proof of honest execution.",
  ];
  const summary = lines.join("\n");
  await github(
    `/check-runs/${check.id}`,
    {
      status: "completed",
      conclusion: "success",
      completed_at: new Date().toISOString(),
      output: {
        title:
          RELAY_MODE === "firewall"
            ? "Fresh CI passed; container removed"
            : "Trusted receipt verified",
        summary,
      },
    },
    "PATCH",
  );
  if (GITHUB_STEP_SUMMARY) await appendFile(GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
} catch (error) {
  await github(
    `/check-runs/${check.id}`,
    {
      status: "completed",
      conclusion: "failure",
      completed_at: new Date().toISOString(),
      output: {
        title: "CI verification did not pass",
        summary: `${error.message}\n\n[Open Relay](${base})`,
      },
    },
    "PATCH",
  );
  throw error;
}
