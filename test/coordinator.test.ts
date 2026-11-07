import { generateKeyPairSync } from "node:crypto";
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
    github,
  });
  return { store, provider, github, coordinator, app };
};
const settle = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

describe("container lifecycle", () => {
  it("does not accept a result after the lease expires", async () => {
    const { coordinator, store } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    store.updateRun(run.id, {
      createdAt: new Date(Date.now() - 700_000).toISOString(),
    });
    const time = new Date().toISOString();
    coordinator.complete(run.id, {
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
  it("reserves a single runner slot before provisioning", async () => {
    const { coordinator, store } = setup();
    const results = await Promise.allSettled([
      coordinator.start("a".repeat(40), "manual"),
      coordinator.start("c".repeat(40), "manual"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(store.runs()).toHaveLength(1);
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
    coordinator.complete(run.id, {
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
    coordinator.complete(run.id, {
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
    coordinator.complete(run.id, {
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
    });
    await coordinator.reconcile();
    await settle();
    expect(store.getRun(run.id)?.status).toBe("timed_out");
  });
  it("forces a fresh firewall run even with a passing receipt", async () => {
    const { coordinator, store } = setup();
    const run = await coordinator.start("main", "manual");
    await settle();
    const time = new Date().toISOString();
    coordinator.complete(run.id, {
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
  it("accepts a signed local receipt only when GitHub confirms the tree", async () => {
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
    github.resolve.mockResolvedValueOnce({
      sha: claim.commit,
      tree: "c".repeat(40),
      message: "changed",
    });
    expect(
      (
        await app.request("/api/receipts", {
          method: "POST",
          body: JSON.stringify(receipt),
        })
      ).status,
    ).toBe(400);
  });
});

describe("GitHub source resolution", () => {
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
