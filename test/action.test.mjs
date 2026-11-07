import { describe, expect, it, vi } from "vitest";
import { runAction } from "../action/run.mjs";

const head = "a".repeat(40);
const merge = "b".repeat(40);
const base = "c".repeat(40);
const env = {
  ACORN_URL: "https://acorn.example",
  ACORN_COMMIT: head,
  ACORN_MODE: "fallback",
  ACORN_TOKEN: "automation",
  GH_TOKEN: "github",
  GITHUB_REPOSITORY: "owner/repo",
  ACORN_PULL_REQUEST: "1",
};
const receipt = { id: "receipt", runId: "run" };
const verification = {
  verified: true,
  commit: head,
  tree: "tree",
  recipeDigest: "recipe",
  receipt,
  signer: { source: "local", id: "key" },
};
const fixture = ({
  reused = false,
  failed = false,
  changed = false,
  wrongReceipt = false,
  autoMerge = false,
  withdrawn = false,
  changedBase = false,
} = {}) => {
  const checks = [];
  let prReads = 0;
  const request = vi.fn(async (url, options) => {
    let data;
    if (url.endsWith("/pulls/1")) {
      prReads += 1;
      data = {
        state: "open",
        head: { sha: changed && prReads > 1 ? merge : head },
        base: { sha: changedBase && prReads > 1 ? merge : base },
        auto_merge: autoMerge && !(withdrawn && prReads > 1) ? {} : null,
      };
    } else if (url.endsWith("/check-runs")) data = { id: 42 };
    else if (url.endsWith("/check-runs/42")) {
      checks.push(JSON.parse(options.body));
      data = {};
    } else if (url.endsWith("/api/runs"))
      data = reused
        ? { reused: true, verification }
        : { reused: false, run: { id: "run", status: "queued" } };
    else if (url.endsWith("/api/runs/run"))
      data = {
        id: "run",
        commit: merge,
        receiptId: "receipt",
        status: failed ? "failed" : "passed",
        cleanupAt: "now",
        logs: "assertion failed: expected 12, got 13\n</pre><script>bad</script>",
        error: failed ? "CI exited with code 1" : null,
        pullRequest: { number: 1, head, base },
      };
    else if (url.includes("/api/verify?"))
      data = {
        ...verification,
        commit: merge,
        receipt: wrongReceipt ? { id: "old", runId: "other" } : receipt,
      };
    else throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(data));
  });
  return { checks, request };
};

describe("GitHub action", () => {
  it("waits for merge intent by default without starting compute", async () => {
    const { request, checks } = fixture();
    await runAction(
      { ...env, ACORN_MODE: "firewall", ACORN_WAIT_FOR_MERGE: "true" },
      request,
      async () => {},
    );
    expect(checks.at(-1).status).toBe("queued");
    expect(checks.at(-1).conclusion).toBeUndefined();
    expect(checks.at(-1).output.summary).toContain("Enable auto-merge");
    expect(request.mock.calls.some(([url]) => url.includes("/api/"))).toBe(false);
  });
  it("starts fresh merge CI when auto-merge is requested", async () => {
    const { request, checks } = fixture({ autoMerge: true });
    await runAction(
      { ...env, ACORN_MODE: "firewall", ACORN_WAIT_FOR_MERGE: "true" },
      request,
      async () => {},
    );
    const start = request.mock.calls.find(([url]) => url.endsWith("/api/runs"));
    expect(JSON.parse(start[1].body)).toEqual({
      commit: head,
      reason: "firewall",
      pullRequest: 1,
    });
    expect(checks.at(-1).conclusion).toBe("success");
    expect(checks.at(-1).output.title).toBe("Full CI passed before merge");
  });
  it("reports an explicit opt-out without starting compute", async () => {
    const { request, checks } = fixture();
    await runAction(
      {
        ...env,
        ACORN_MODE: "firewall",
        ACORN_WAIT_FOR_MERGE: "true",
        ACORN_MERGE_GATE: "false",
      },
      request,
      async () => {},
    );
    expect(checks.at(-1).conclusion).toBe("skipped");
    expect(checks.at(-1).output.title).toBe("Merge gate disabled");
    expect(request.mock.calls.some(([url]) => url.includes("/api/"))).toBe(false);
  });
  it("fails an automatic merge gate when the tests fail", async () => {
    const { request, checks } = fixture({ autoMerge: true, failed: true });
    await expect(
      runAction(
        { ...env, ACORN_MODE: "firewall", ACORN_WAIT_FOR_MERGE: "true" },
        request,
        async () => {},
      ),
    ).rejects.toThrow("CI failed");
    expect(checks.at(-1).conclusion).toBe("failure");
    expect(checks.at(-1).output.summary).toContain("expected 12, got 13");
  });
  it("does not disable regular PR CI when the merge gate is off", async () => {
    const { request, checks } = fixture({ failed: true });
    await expect(
      runAction({ ...env, ACORN_MERGE_GATE: "false" }, request, async () => {}),
    ).rejects.toThrow("CI failed");
    expect(checks.at(-1).conclusion).toBe("failure");
  });
  it("does not pass a gate after the merge request is withdrawn", async () => {
    const { request, checks } = fixture({ autoMerge: true, withdrawn: true });
    await expect(
      runAction(
        { ...env, ACORN_MODE: "firewall", ACORN_WAIT_FOR_MERGE: "true" },
        request,
        async () => {},
      ),
    ).rejects.toThrow("withdrawn");
    expect(checks.at(-1).conclusion).toBe("cancelled");
  });
  it("does not pass a gate after its target branch changes", async () => {
    const { request, checks } = fixture({ autoMerge: true, changedBase: true });
    await expect(
      runAction(
        { ...env, ACORN_MODE: "firewall", ACORN_WAIT_FOR_MERGE: "true" },
        request,
        async () => {},
      ),
    ).rejects.toThrow("superseded");
    expect(checks.at(-1).conclusion).toBe("cancelled");
  });
  it("reuses a published receipt immediately without waiting or running tests", async () => {
    const { request, checks } = fixture({ reused: true });
    const wait = vi.fn();
    await runAction(env, request, wait);
    expect(wait).not.toHaveBeenCalled();
    expect(checks.at(-1).conclusion).toBe("success");
    expect(checks.at(-1).output.title).toContain("receipt reused");
  });
  it("reports failed test output on the GitHub check", async () => {
    const { request, checks } = fixture({ failed: true });
    await expect(runAction(env, request, async () => {})).rejects.toThrow(
      "CI failed",
    );
    expect(checks.at(-1).conclusion).toBe("failure");
    expect(checks.at(-1).output.summary).toContain("expected 12, got 13");
    expect(checks.at(-1).output.summary).not.toContain("<script>");
  });
  it("verifies the merge run's own receipt and includes the tested merge SHA", async () => {
    const { request, checks } = fixture();
    await runAction(
      { ...env, ACORN_MODE: "firewall" },
      request,
      async () => {},
    );
    expect(
      request.mock.calls.some(([url]) =>
        url.endsWith(`commit=${merge}&receipt=receipt`),
      ),
    ).toBe(true);
    expect(checks.at(-1).output.summary).toContain(
      `Tested commit: \`${merge}\``,
    );
    expect(checks.at(-1).conclusion).toBe("success");
  });
  it("cannot pass a merge gate using a different run's receipt", async () => {
    const { request, checks } = fixture({ wrongReceipt: true });
    await expect(
      runAction({ ...env, ACORN_MODE: "firewall" }, request, async () => {}),
    ).rejects.toThrow("own verified receipt");
    expect(checks.at(-1).conclusion).toBe("failure");
  });
  it("cannot pass the PR after its head changes during CI", async () => {
    const { request, checks } = fixture({ changed: true });
    await expect(runAction(env, request, async () => {})).rejects.toThrow(
      "superseded",
    );
    expect(checks.at(-1).conclusion).toBe("cancelled");
  });
});
