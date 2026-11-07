import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  digest,
  keyId,
  objectDigest,
  signReceipt,
} from "../src/core/receipts.ts";
import { createCoordinator } from "../src/server/coordinator.ts";
import { createStore, type Store } from "../src/server/store.ts";
import { createGithub } from "../src/server/github.ts";
import { createApp } from "../src/server/app.ts";
import { config, recipe } from "../src/server/config.ts";
import type { Provider, RunnerService } from "../src/server/railway.ts";
import type { Run } from "../src/core/types.ts";

const keys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const stores: Store[] = [];
afterEach(() => {
  stores.forEach((store) => store.close());
  stores.length = 0;
});
const setup = () => {
  const store = createStore(":memory:");
  stores.push(store);
  let services: RunnerService[] = [];
  const provider: Provider = {
    configured: true,
    create: vi.fn(async (name) => {
      services.push({
        id: "service-1",
        name,
        deploymentId: null,
        status: "DEPLOYING",
      });
      return "service-1";
    }),
    start: vi.fn(async () => {}),
    remove: vi.fn(async () => {
      services = [];
    }),
    services: vi.fn(async () => services),
  };
  const github = {
    pullHead: vi.fn(async (_number: number) => "a".repeat(40)),
    mergeCandidate: vi.fn(async (_number: number, _head: string) => ({
      sha: "d".repeat(40),
      tree: "b".repeat(40),
      message: "Merge PR",
      base: "a".repeat(40),
    })),
    resolve: vi.fn(async (commit: string) => ({
      sha: commit === "main" ? "a".repeat(40) : commit,
      tree: "b".repeat(40),
      message: "Update order calculator",
    })),
  };
  const coordinator = createCoordinator({
    store,
    provider,
    github,
    recipe,
    privateKey: keys.privateKey,
    runTtlMs: 600_000,
  });
  const app = createApp({
    store,
    coordinator,
    config: {
      ...config,
      adminToken: "operator-secret",
      automationToken: "automation-secret",
    },
  });
  return { store, provider, github, coordinator, app };
};
const settle = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

describe("container lifecycle", () => {
  it("starts queued work after the preceding container is removed", async () => {
    const { coordinator, provider, store } = setup();
    const first = await coordinator.start("a".repeat(40), "manual");
    const second = await coordinator.start("c".repeat(40), "manual");
    await settle();
    expect(store.getRun(second.id)?.status).toBe("queued");
    coordinator.stop(first.id);
    await settle();
    expect(store.getRun(first.id)?.cleanupAt).toBeTruthy();
    expect(store.getRun(second.id)?.status).toBe("starting");
    expect(provider.create).toHaveBeenCalledTimes(2);
  });
  it("cancels superseded PR work without cancelling a different PR", async () => {
    const { coordinator, github, store } = setup();
    const first = await coordinator.requestRun("a".repeat(40), "fallback", 1);
    const other = await coordinator.requestRun("a".repeat(40), "fallback", 2);
    await settle();
    github.pullHead.mockImplementation(async (number) =>
      (number === 1 ? "c" : "a").repeat(40),
    );
    const latest = await coordinator.requestRun("c".repeat(40), "fallback", 1);
    await settle();
    if (first.reused || other.reused || latest.reused)
      throw new Error("Expected remote runs");
    expect(store.getRun(first.run.id)?.outcome).toBe("cancelled");
    expect(store.getRun(other.run.id)?.outcome).toBeNull();
    expect(store.getRun(latest.run.id)?.outcome).toBeNull();
  });
  it("rejects a delayed workflow for an old PR head", async () => {
    const { coordinator, provider } = setup();
    await expect(
      coordinator.requestRun("c".repeat(40), "fallback", 1),
    ).rejects.toThrow("no longer");
    expect(provider.create).not.toHaveBeenCalled();
  });
  it("reconciles obsolete PR runners even if the replacement workflow never starts", async () => {
    const { coordinator, github, store } = setup();
    const first = await coordinator.requestRun("a".repeat(40), "fallback", 1);
    await settle();
    github.pullHead.mockResolvedValue("c".repeat(40));
    await coordinator.reconcile();
    await settle();
    if (first.reused) throw new Error("Expected remote run");
    expect(store.getRun(first.run.id)?.outcome).toBe("cancelled");
    expect(store.getRun(first.run.id)?.cleanupAt).toBeTruthy();
  });
  it("tests the proposed merge and rejects completion after its base changes", async () => {
    const { coordinator, github, store } = setup();
    const result = await coordinator.requestRun("a".repeat(40), "firewall", 1);
    await settle();
    if (result.reused) throw new Error("Merge gates must run CI");
    expect(result.run.commit).toBe("d".repeat(40));
    expect(result.run.pullRequest).toEqual({
      number: 1,
      head: "a".repeat(40),
      base: "a".repeat(40),
    });
    github.resolve.mockResolvedValue({
      sha: "e".repeat(40),
      tree: "b".repeat(40),
      message: "New base",
    });
    const time = new Date().toISOString();
    await coordinator.complete(result.run.id, {
      tree: result.run.tree,
      output: "pass",
      logDigest: digest("pass"),
      exitCode: 0,
      startedAt: time,
      finishedAt: time,
    });
    await settle();
    expect(store.getRun(result.run.id)?.outcome).toBe("cancelled");
    expect(store.receipts()).toHaveLength(0);
  });
  it("still supersedes a runner when the new head already has a receipt", async () => {
    const { coordinator, store, github } = setup();
    const completed = await coordinator.start("main", "manual");
    await settle();
    const time = new Date().toISOString();
    await coordinator.complete(completed.id, {
      tree: completed.tree,
      output: "pass",
      logDigest: digest("pass"),
      exitCode: 0,
      startedAt: time,
      finishedAt: time,
    });
    await settle();
    const running = await coordinator.requestRun("a".repeat(40), "firewall", 1);
    await settle();
    github.pullHead.mockResolvedValue("c".repeat(40));
    const next = await coordinator.requestRun("c".repeat(40), "fallback", 1);
    await settle();
    expect(next.reused).toBe(true);
    if (running.reused) throw new Error("Expected merge run");
    expect(store.getRun(running.run.id)?.outcome).toBe("cancelled");
  });
  it("does not accept a result after the lease expires", async () => {
    const { coordinator, store } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    store.updateRun(run.id, {
      createdAt: new Date(Date.now() - 700_000).toISOString(),
      allocatedAt: new Date(Date.now() - 700_000).toISOString(),
    });
    const time = new Date().toISOString();
    await coordinator.complete(run.id, {
      tree: run.tree,
      output: "",
      logDigest: digest(""),
      exitCode: 0,
      startedAt: time,
      finishedAt: time,
    });
    await settle();
    expect(store.receipts()).toHaveLength(0);
    expect(store.getRun(run.id)?.status).toBe("timed_out");
  });
  it("queues concurrent requests while reserving one physical runner", async () => {
    const { coordinator, store } = setup();
    const results = await Promise.allSettled([
      coordinator.start("a".repeat(40), "manual"),
      coordinator.start("c".repeat(40), "manual"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(store.runs()).toHaveLength(2);
    expect(
      store.runs().filter((run) => run.status === "starting"),
    ).toHaveLength(1);
    expect(store.runs().filter((run) => run.status === "queued")).toHaveLength(
      1,
    );
    await settle();
  });
  it("deduplicates repeated starts for the same commit and purpose", async () => {
    const { coordinator, provider } = setup();
    const first = await coordinator.start("main", "manual");
    const second = await coordinator.start("main", "manual");
    expect(first.id).toBe(second.id);
    expect(provider.create).toHaveBeenCalledTimes(1);
    await settle();
  });
  it("signs passing results and confirms removal before closing the run", async () => {
    const { coordinator, store, provider } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    const time = new Date().toISOString();
    await coordinator.complete(run.id, {
      tree: run.tree,
      output: "10 tests passed",
      logDigest: digest("10 tests passed"),
      exitCode: 0,
      startedAt: time,
      finishedAt: time,
    });
    expect(store.getRun(run.id)?.status).toBe("stopping");
    await settle();
    expect(store.getRun(run.id)?.status).toBe("passed");
    expect(store.getRun(run.id)?.cleanupAt).not.toBeNull();
    expect(provider.remove).toHaveBeenCalledWith("service-1");
    expect(store.receipts()).toHaveLength(1);
    expect((await coordinator.verify("c".repeat(40))).reused).toBe(true);
  });
  it("never issues a receipt for failed CI", async () => {
    const { coordinator, store } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    const time = new Date().toISOString();
    await coordinator.complete(run.id, {
      tree: run.tree,
      output: "failure",
      logDigest: digest("failure"),
      exitCode: 1,
      startedAt: time,
      finishedAt: time,
    });
    await settle();
    expect(store.receipts()).toHaveLength(0);
    expect(store.getRun(run.id)?.status).toBe("failed");
  });
  it("ignores a late successful callback after cancellation", async () => {
    const { coordinator, store } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    coordinator.stop(run.id);
    const time = new Date().toISOString();
    await coordinator.complete(run.id, {
      tree: run.tree,
      output: "",
      logDigest: digest(""),
      exitCode: 0,
      startedAt: time,
      finishedAt: time,
    });
    await settle();
    expect(store.getRun(run.id)?.status).toBe("cancelled");
    expect(store.receipts()).toHaveLength(0);
  });
  it("cleans up when stop races with service creation", async () => {
    const { coordinator, provider, store } = setup();
    let resolveCreate!: (id: string) => void;
    vi.mocked(provider.create).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const run = await coordinator.start("main", "manual");
    await settle();
    coordinator.stop(run.id);
    resolveCreate("late-service");
    await settle();
    expect(provider.start).not.toHaveBeenCalled();
    expect(store.getRun(run.id)?.status).toBe("cancelled");
  });
  it("leaves cleanup visibly pending and retries after an API failure", async () => {
    const { coordinator, provider, store } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    vi.mocked(provider.remove).mockRejectedValueOnce(
      new Error("Railway unavailable"),
    );
    coordinator.stop(run.id);
    await settle();
    expect(store.getRun(run.id)?.status).toBe("stopping");
    expect(store.getRun(run.id)?.cleanupError).toContain("unavailable");
    await coordinator.reconcile();
    expect(store.getRun(run.id)?.status).toBe("cancelled");
  });
  it("recovers a create response lost after Railway allocated the service", async () => {
    const { coordinator, provider, store } = setup();
    vi.mocked(provider.create).mockImplementationOnce(async (name) => {
      vi.mocked(provider.services).mockResolvedValueOnce([
        { id: "orphan", name, deploymentId: null, status: "DEPLOYING" },
      ]);
      throw new Error("Connection lost");
    });
    const run = await coordinator.start("main", "manual");
    await settle();
    expect(provider.remove).toHaveBeenCalledWith("orphan");
    expect(store.getRun(run.id)?.status).toBe("failed");
  });
  it("expires abandoned runs", async () => {
    const { coordinator, store } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    store.updateRun(run.id, {
      createdAt: new Date(Date.now() - 700_000).toISOString(),
      allocatedAt: new Date(Date.now() - 700_000).toISOString(),
    });
    await coordinator.reconcile();
    await settle();
    expect(store.getRun(run.id)?.status).toBe("timed_out");
  });
  it("keeps queued work waiting past the lease until the runner is free", async () => {
    const { coordinator, store } = setup();
    const first = await coordinator.start("a".repeat(40), "manual");
    const second = await coordinator.start("c".repeat(40), "manual");
    await settle();
    store.updateRun(second.id, {
      createdAt: new Date(Date.now() - 700_000).toISOString(),
    });
    await coordinator.reconcile();
    await settle();
    expect(store.getRun(second.id)?.status).toBe("queued");
    coordinator.stop(first.id);
    await settle();
    expect(store.getRun(second.id)?.status).toBe("starting");
  });
  it("still expires an old runner after many newer runs", async () => {
    const { coordinator, store } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    store.updateRun(run.id, {
      allocatedAt: new Date(Date.now() - 700_000).toISOString(),
    });
    for (let i = 0; i < 501; i++)
      store.saveRun({
        ...run,
        id: `done-${i}`,
        status: "passed",
        outcome: "passed",
      });
    await coordinator.reconcile();
    await settle();
    expect(store.getRun(run.id)?.status).toBe("timed_out");
  });
  it("retires the old coordinator key when the key rotates", async () => {
    const { coordinator, store, github, provider } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    const time = new Date().toISOString();
    await coordinator.complete(run.id, {
      tree: run.tree,
      output: "",
      logDigest: digest(""),
      exitCode: 0,
      startedAt: time,
      finishedAt: time,
    });
    await settle();
    expect((await coordinator.verify(run.commit)).verified).toBe(true);
    const next = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const rotated = createCoordinator({
      store,
      provider,
      github,
      recipe,
      privateKey: next.privateKey,
      runTtlMs: 600_000,
    });
    expect(
      store.signers().find((s) => s.id === keyId(keys.publicKey))?.revokedAt,
    ).toBeTruthy();
    expect(
      store.signers().find((s) => s.id === keyId(next.publicKey))?.revokedAt,
    ).toBeNull();
    expect((await rotated.verify(run.commit)).verified).toBe(false);
  });
  it("refuses to boot with a retired coordinator key", () => {
    const { store, provider, github } = setup();
    const next = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const boot = (privateKey: string) =>
      createCoordinator({
        store,
        provider,
        github,
        recipe,
        privateKey,
        runTtlMs: 600_000,
      });
    boot(next.privateKey);
    expect(() => boot(keys.privateKey)).toThrow("retired");
    expect(
      store.signers().find((s) => s.id === keyId(next.publicKey))?.revokedAt,
    ).toBeNull();
  });
  it("does not sign a run that started under a different recipe", async () => {
    const { coordinator, store, provider, github } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    const restarted = createCoordinator({
      store,
      provider,
      github,
      recipe: { ...recipe, command: ["node", "-e", "process.exit(1)"] },
      privateKey: keys.privateKey,
      runTtlMs: 600_000,
    });
    const time = new Date().toISOString();
    await restarted.complete(run.id, {
      tree: run.tree,
      output: "",
      logDigest: digest(""),
      exitCode: 0,
      startedAt: time,
      finishedAt: time,
    });
    await settle();
    expect(store.getRun(run.id)?.outcome).toBe("failed");
    expect(store.receipts()).toHaveLength(0);
  });
  it("forces a fresh firewall run even with a passing receipt", async () => {
    const { coordinator, store } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    const time = new Date().toISOString();
    await coordinator.complete(run.id, {
      tree: run.tree,
      output: "",
      logDigest: digest(""),
      exitCode: 0,
      startedAt: time,
      finishedAt: time,
    });
    await settle();
    const firewall = await coordinator.start("main", "firewall");
    expect(firewall.id).not.toBe(run.id);
    expect(store.runs()).toHaveLength(2);
    await settle();
  });
});

describe("HTTP trust boundary", () => {
  it("allows public observation but prevents unauthenticated compute", async () => {
    const { app, provider } = setup();
    expect((await app.request("/api/state")).status).toBe(200);
    expect(
      (
        await app.request("/api/runs", {
          method: "POST",
          body: JSON.stringify({ commit: "main" }),
        })
      ).status,
    ).toBe(401);
    expect(provider.create).not.toHaveBeenCalled();
  });
  it("does not expose callback hashes in public run data", async () => {
    const { app, coordinator } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    expect(
      await (await app.request(`/api/runs/${run.id}`)).text(),
    ).not.toContain("callbackHash");
    expect(await (await app.request("/api/state")).text()).not.toContain(
      "callbackHash",
    );
  });
  it("requires the run credential on both the spec and callback routes", async () => {
    const { app, coordinator, provider } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    expect((await app.request(`/api/internal/runs/${run.id}`)).status).toBe(
      401,
    );
    expect(
      (
        await app.request(`/api/internal/runs/${run.id}/started`, {
          method: "POST",
          body: "{}",
        })
      ).status,
    ).toBe(401);
    const token = vi.mocked(provider.start).mock.calls[0][2];
    expect(
      (
        await app.request(`/api/internal/runs/${run.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
  });
  it("scopes automation credentials to starting runs", async () => {
    const { app } = setup();
    const response = await app.request("/api/signers", {
      method: "POST",
      headers: { Authorization: "Bearer automation-secret" },
      body: "{}",
    });
    expect(response.status).toBe(401);
  });
  it("rejects cross-origin authenticated writes", async () => {
    const { app } = setup();
    expect(
      (
        await app.request("/api/runs", {
          method: "POST",
          headers: {
            Authorization: "Bearer operator-secret",
            Origin: "https://attacker.example",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
  });
  it("accepts receipts before push but requires GitHub source verification before reuse", async () => {
    const { app, store, github } = setup();
    const local = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const signerId = keyId(local.publicKey);
    store.saveSigner({
      id: signerId,
      label: "Laptop",
      publicKey: local.publicKey,
      source: "local",
      revokedAt: null,
      addedAt: new Date().toISOString(),
    });
    const claim = {
      version: 1 as const,
      repository: recipe.repository,
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      recipeDigest: objectDigest(recipe),
      signerId,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0 as const,
      logDigest: digest(""),
    };
    const receipt = signReceipt(claim, local.privateKey);
    expect(
      (
        await app.request("/api/receipts", {
          method: "POST",
          body: JSON.stringify(receipt),
        })
      ).status,
    ).toBe(201);
    expect(github.resolve).not.toHaveBeenCalled();
    github.resolve.mockRejectedValueOnce(
      new Error("Commit has not been pushed"),
    );
    expect(
      (await app.request(`/api/verify?commit=${claim.commit}`)).status,
    ).toBe(400);
    github.resolve.mockResolvedValueOnce({
      sha: claim.commit,
      tree: "c".repeat(40),
      message: "changed",
    });
    expect(
      await (await app.request(`/api/verify?commit=${claim.commit}`)).json(),
    ).toMatchObject({ verified: false });
    expect(
      await (await app.request(`/api/verify?commit=${claim.commit}`)).json(),
    ).toMatchObject({ verified: true });
  });
  it("keeps public traffic from using up CI's request budget", async () => {
    const { app, github } = setup();
    for (let i = 0; i < 40; i++) {
      await app.request("/api/receipts", { method: "POST", body: "{}" });
      await app.request(`/api/verify?commit=${"a".repeat(40)}`);
    }
    expect(
      (await app.request(`/api/verify?commit=${"a".repeat(40)}`)).status,
    ).toBe(429);
    const automation = { Authorization: "Bearer automation-secret" };
    expect(
      (
        await app.request(`/api/verify?commit=${"a".repeat(40)}`, {
          headers: automation,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/api/runs", {
          method: "POST",
          headers: automation,
          body: JSON.stringify({ commit: "main" }),
        })
      ).status,
    ).toBe(202);
    expect(github.resolve).toHaveBeenCalled();
  });
});

describe("SQLite store", () => {
  it("drops the old one-active-run index so work can queue", () => {
    const dir = mkdtempSync(join(tmpdir(), "acorn-store-"));
    const path = join(dir, "acorn.sqlite");
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL); CREATE UNIQUE INDEX one_active_run ON runs((1)) WHERE status IN ('queued', 'starting', 'running', 'stopping');",
    );
    old.close();
    const store = createStore(path);
    stores.push(store);
    const run = { id: "a", status: "running" } as Run;
    store.saveRun(run);
    expect(() =>
      store.saveRun({ ...run, id: "b", status: "queued" }),
    ).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("GitHub source resolution", () => {
  it("accepts only a merge candidate with the current base and requested head", async () => {
    const base = "a".repeat(40);
    const head = "c".repeat(40);
    const merged = {
      sha: "d".repeat(40),
      tree: "b".repeat(40),
      message: "Merge",
      parents: [base, head],
    };
    const git = vi.fn(async () => merged);
    const github = createGithub(
      recipe,
      "",
      async () =>
        new Response(
          JSON.stringify({
            sha: base,
            commit: { tree: { sha: "b".repeat(40) }, message: "Base" },
          }),
        ),
      git,
    );
    expect(await github.mergeCandidate(1, head)).toMatchObject({
      sha: merged.sha,
      base,
    });
    await expect(github.mergeCandidate(1, "e".repeat(40))).rejects.toThrow(
      "proposed merge changed",
    );
    git.mockResolvedValue({ ...merged, parents: ["f".repeat(40), head] });
    await expect(github.mergeCandidate(1, head)).rejects.toThrow(
      "proposed merge changed",
    );
  });
  it("falls back to public Git when the API is rate limited", async () => {
    const commit = {
      sha: "a".repeat(40),
      tree: "b".repeat(40),
      message: "public source",
    };
    const fallback = vi.fn(async () => commit);
    const github = createGithub(
      recipe,
      "",
      async () => new Response("", { status: 403 }),
      fallback,
    );
    expect(await github.resolve(commit.sha)).toEqual(commit);
    expect(fallback).toHaveBeenCalledWith(recipe.repository, commit.sha);
  });
  it("does not follow arbitrary refs or send credentials to arbitrary hosts", async () => {
    const request = vi.fn();
    const github = createGithub(recipe, "secret", request);
    await expect(github.resolve("../../someone/private")).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
