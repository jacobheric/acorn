import { createPublicKey, randomBytes, randomUUID } from "node:crypto";
import {
  digest,
  keyId,
  objectDigest,
  signReceipt,
  validateReceipt,
} from "../core/receipts.ts";
import {
  isActive,
  type Recipe,
  type Run,
  type StoredReceipt,
  type Verification,
} from "../core/types.ts";
import type { Store } from "./store.ts";
import type { Provider } from "./railway.ts";
import type { createGithub } from "./github.ts";

export const createCoordinator = (options: {
  store: Store;
  provider: Provider;
  github: ReturnType<typeof createGithub>;
  recipe: Recipe;
  privateKey: string;
  runTtlMs: number;
}) => {
  const { store, provider, github, recipe, privateKey, runTtlMs } = options;
  const recipeDigest = objectDigest(recipe);
  const launching = new Set<string>();
  const cleaning = new Set<string>();
  let reconciling = false;
  let providerError: string | null = null;
  const publicKey = privateKey
    ? createPublicKey(privateKey)
        .export({ type: "spki", format: "pem" })
        .toString()
    : null;
  const signerId = publicKey ? keyId(publicKey) : null;
  if (
    publicKey &&
    signerId &&
    !store.signers().some((signer) => signer.id === signerId)
  ) {
    store.saveSigner({
      id: signerId,
      publicKey,
      label: "Railway runner",
      source: "railway",
      addedAt: new Date().toISOString(),
      revokedAt: null,
    });
  }
  const cleanup = async (id: string) => {
    if (launching.has(id) || cleaning.has(id)) return;
    const run = store.getRun(id);
    if (!run || !run.outcome) return;
    cleaning.add(id);
    try {
      const services = await provider.services();
      const targets = services.filter(
        (service) =>
          service.id === run.serviceId || service.name === `relay-${id}`,
      );
      for (const service of targets) await provider.remove(service.id);
      const remaining = await provider.services();
      if (
        remaining.some((service) =>
          targets.some((target) => target.id === service.id),
        )
      )
        throw new Error("Railway is still removing the container");
      store.updateRun(id, {
        status: run.outcome,
        cleanupAt: new Date().toISOString(),
        cleanupError: null,
      });
    } catch (error) {
      store.updateRun(id, { cleanupError: (error as Error).message });
    } finally {
      cleaning.delete(id);
    }
  };
  const finish = (
    id: string,
    outcome: NonNullable<Run["outcome"]>,
    error: string | null = null,
  ) => {
    const run = store.getRun(id);
    if (!run || run.outcome) return;
    store.updateRun(id, {
      status: "stopping",
      outcome,
      error,
      finishedAt: new Date().toISOString(),
    });
    void cleanup(id);
  };
  const launch = async (run: Run, token: string) => {
    launching.add(run.id);
    try {
      store.updateRun(run.id, { status: "starting" });
      const serviceId = await provider.create(`relay-${run.id}`);
      store.updateRun(run.id, { serviceId });
      if (!store.getRun(run.id)?.outcome)
        await provider.start(serviceId, run.id, token);
    } catch (error) {
      finish(run.id, "failed", (error as Error).message);
    } finally {
      launching.delete(run.id);
      if (store.getRun(run.id)?.outcome) await cleanup(run.id);
    }
  };
  const verify = async (commit: string): Promise<Verification> => {
    const resolved = await github.resolve(commit);
    const receipts = store.receiptsForTree(resolved.tree);
    let reason = "No trusted receipt for this source tree";
    for (const receipt of receipts) {
      const signer = store
        .signers()
        .find((candidate) => candidate.id === receipt.claim.signerId);
      const result = validateReceipt(
        { claim: receipt.claim, signature: receipt.signature },
        signer,
        { repository: recipe.repository, tree: resolved.tree, recipeDigest },
      );
      if (result.valid)
        return {
          verified: true,
          reason: "Trusted signature, matching source tree and CI recipe",
          commit: resolved.sha,
          tree: resolved.tree,
          recipeDigest,
          receipt,
          signer: signer!,
          reused: receipt.claim.commit !== resolved.sha,
        };
      reason = result.reason;
    }
    return {
      verified: false,
      reason,
      commit: resolved.sha,
      tree: resolved.tree,
      recipeDigest,
      receipt: null,
      signer: null,
      reused: false,
    };
  };
  const start = async (ref: string, reason: Run["reason"]) => {
    if (!provider.configured || !signerId)
      throw new Error("Railway runners are not configured");
    const resolved = await github.resolve(ref);
    const existing = store.runs().find(isActive);
    if (existing) {
      if (
        existing.commit === resolved.sha &&
        existing.reason === reason &&
        !existing.outcome
      )
        return existing;
      throw new Error(
        "A runner is already active. Stop it or wait for cleanup.",
      );
    }
    const token = randomBytes(32).toString("base64url");
    const run: Run = {
      id: randomUUID(),
      repository: recipe.repository,
      commit: resolved.sha,
      tree: resolved.tree,
      message: resolved.message,
      status: "queued",
      outcome: null,
      reason,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      serviceId: null,
      deploymentId: null,
      cleanupAt: null,
      cleanupError: null,
      callbackHash: digest(token),
      receiptId: null,
      logs: "",
      error: null,
    };
    store.saveRun(run);
    void launch(run, token);
    return run;
  };
  const complete = (
    id: string,
    result: {
      tree: string;
      startedAt: string;
      finishedAt: string;
      output: string;
      exitCode: number;
      logDigest: string;
    },
  ) => {
    const run = store.getRun(id);
    if (!run || run.outcome) return;
    if (Date.now() - Date.parse(run.createdAt) > runTtlMs) {
      finish(id, "timed_out", "Runner exceeded its 10 minute lease");
      return;
    }
    if (result.tree !== run.tree || digest(result.output) !== result.logDigest)
      throw new Error(
        "Runner result does not match the requested source or log",
      );
    if (
      Date.parse(result.startedAt) < Date.parse(run.createdAt) - 30_000 ||
      Date.parse(result.finishedAt) > Date.now() + 30_000 ||
      Date.parse(result.finishedAt) < Date.parse(result.startedAt)
    )
      throw new Error("Invalid runner timestamps");
    store.updateRun(id, { logs: result.output, startedAt: result.startedAt });
    if (result.exitCode === 0 && signerId) {
      const receipt = signReceipt(
        {
          version: 1,
          repository: run.repository,
          commit: run.commit,
          tree: run.tree,
          recipeDigest,
          signerId,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          exitCode: 0,
          logDigest: result.logDigest,
        },
        privateKey,
      );
      const stored: StoredReceipt = {
        ...receipt,
        id: objectDigest(receipt),
        receivedAt: new Date().toISOString(),
        runId: id,
      };
      store.saveReceipt(stored);
      store.updateRun(id, { receiptId: stored.id });
    }
    finish(
      id,
      result.exitCode === 0
        ? "passed"
        : result.exitCode === 124
          ? "timed_out"
          : "failed",
      result.exitCode === 0 ? null : `CI exited with code ${result.exitCode}`,
    );
  };
  const reconcile = async () => {
    if (reconciling || !provider.configured) return;
    reconciling = true;
    try {
      for (const run of store.runs().filter(isActive)) {
        if (!run.outcome && Date.now() - Date.parse(run.createdAt) > runTtlMs) {
          finish(run.id, "timed_out", "Runner exceeded its 10 minute lease");
        }
      }
      const services = await provider.services();
      providerError = null;
      for (const run of store.runs().filter(isActive)) {
        const service = services.find(
          (candidate) =>
            candidate.id === run.serviceId ||
            candidate.name === `relay-${run.id}`,
        );
        if (service)
          store.updateRun(run.id, {
            serviceId: service.id,
            deploymentId: service.deploymentId,
          });
        if (run.outcome) await cleanup(run.id);
        else if (Date.now() - Date.parse(run.createdAt) > runTtlMs)
          finish(run.id, "timed_out", "Runner exceeded its 10 minute lease");
        else if (
          service?.status &&
          ["FAILED", "CRASHED", "REMOVED"].includes(service.status)
        )
          finish(
            run.id,
            "failed",
            `Railway deployment ${service.status.toLowerCase()} before a result was accepted`,
          );
        else if (!service && !launching.has(run.id))
          finish(
            run.id,
            "failed",
            "Runner was interrupted before provisioning completed",
          );
      }
      for (const service of services) {
        if (!/^relay-[a-f0-9-]{36}$/.test(service.name)) continue;
        const run = store.getRun(service.name.slice(6));
        if (!run || !isActive(run)) await provider.remove(service.id);
      }
    } catch (error) {
      providerError = (error as Error).message;
    } finally {
      reconciling = false;
    }
  };
  return {
    start,
    verify,
    complete,
    reconcile,
    providerError: () => providerError,
    stop: (id: string) => finish(id, "cancelled"),
    fail: (id: string, message: string) => finish(id, "failed", message),
  };
};
