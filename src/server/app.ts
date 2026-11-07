import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
  digest,
  keyId,
  objectDigest,
  validateReceipt,
} from "../core/receipts.ts";
import {
  receiptSchema,
  shaSchema,
  digestSchema,
  type PublicRun,
  type Run,
} from "../core/types.ts";
import type { config as Config } from "./config.ts";
import { recipe, recipeDigest } from "./config.ts";
import type { Store } from "./store.ts";
import type { createCoordinator } from "./coordinator.ts";

const sameSecret = (given: string, expected: string) =>
  Boolean(expected) &&
  timingSafeEqual(Buffer.from(digest(given)), Buffer.from(digest(expected)));
type Env = { Variables: { operator: boolean; automation: boolean } };
const publicRun = ({ callbackHash: _hash, ...run }: Run): PublicRun => run;
const resultSchema = z
  .object({
    tree: shaSchema,
    exitCode: z.number().int().min(0).max(255),
    output: z.string().max(100_000),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    logDigest: digestSchema,
  })
  .strict();

export const createApp = ({
  store,
  coordinator,
  config,
}: {
  store: Store;
  coordinator: ReturnType<typeof createCoordinator>;
  config: typeof Config;
}) => {
  const app = new Hono<Env>();
  const limits = new Map<string, { count: number; until: number }>();
  // public callers share a budget; credentialed callers skip it
  const rateLimit = (c: Context<Env>, key: string, max: number) => {
    if (c.get("operator") || c.get("automation")) return true;
    const now = Date.now();
    for (const [entry, limit] of limits)
      if (limit.until <= now) limits.delete(entry);
    const limit = limits.get(key) ?? { count: 0, until: now + 60_000 };
    limit.count += 1;
    limits.set(key, limit);
    return limit.count <= max;
  };
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    }),
  );
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 256_000,
      onError: (c) => c.json({ error: "Request too large" }, 413),
    }),
  );
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const token = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
    c.set("operator", sameSecret(token, config.adminToken));
    c.set("automation", sameSecret(token, config.automationToken));
    const internal = c.req.path.startsWith("/api/internal/");
    if (!internal && c.req.method !== "GET") {
      const automation = c.req.path === "/api/runs" && c.get("automation");
      if (!c.get("operator") && !automation && c.req.path !== "/api/receipts")
        return c.json({ error: "Operator access required" }, 401);
      const origin = c.req.header("Origin");
      if (
        origin &&
        origin !== new URL(config.publicUrl).origin &&
        origin !== "http://127.0.0.1:5173"
      )
        return c.json({ error: "Origin not allowed" }, 403);
      if (!rateLimit(c, "writes", 30))
        return c.json(
          { error: "Too many requests. Try again in a minute." },
          429,
        );
    }
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: "Invalid request",
          details: error.issues.map((issue) => issue.path.join(".")),
        },
        400,
      );
    return c.json({ error: error.message }, 400);
  });
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/session", (c) => c.json({ operator: c.get("operator") }));
  app.get("/api/recipe", (c) => c.json({ recipe, digest: recipeDigest }));
  app.get("/api/state", (c) =>
    c.json({
      runs: store.runs().map(publicRun),
      receipts: store.receipts(),
      signers: store.signers(),
      recipe,
      recipeDigest,
      configured: Boolean(
        config.railwayToken &&
          config.projectId &&
          config.environmentId &&
          config.privateKey,
      ),
      providerError: coordinator.providerError(),
      repository: recipe.repository,
      operator: c.get("operator"),
      maxConcurrentRuns: 1,
      receiptMaxAgeDays: 7,
    }),
  );
  app.get("/api/verify", async (c) => {
    if (!rateLimit(c, "verify", 20))
      return c.json(
        { error: "Verification rate limit. Try again in a minute." },
        429,
      );
    const commit = shaSchema.parse(c.req.query("commit"));
    const receipt = digestSchema.optional().parse(c.req.query("receipt"));
    return c.json(await coordinator.verify(commit, receipt));
  });
  app.get("/api/runs/:id", (c) => {
    const run = store.getRun(c.req.param("id"));
    return run
      ? c.json(publicRun(run))
      : c.json({ error: "Run not found" }, 404);
  });
  app.post("/api/runs", async (c) => {
    const input = z
      .object({
        commit: z.union([shaSchema, z.literal("main")]),
        reason: z.enum(["manual", "fallback", "firewall"]).default("manual"),
        pullRequest: z.number().int().positive().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const result = await coordinator.requestRun(
      input.commit,
      input.reason,
      input.pullRequest,
    );
    return result.reused
      ? c.json(result)
      : c.json({ ...result, run: publicRun(result.run) }, 202);
  });
  app.post("/api/runs/:id/stop", (c) => {
    const id = c.req.param("id");
    if (!store.getRun(id)) return c.json({ error: "Run not found" }, 404);
    coordinator.stop(id);
    return c.json(publicRun(store.getRun(id)!));
  });
  app.post("/api/signers", async (c) => {
    const input = z
      .object({
        label: z.string().trim().min(1).max(60),
        publicKey: z.string().max(200),
      })
      .strict()
      .parse(await c.req.json());
    const id = keyId(input.publicKey);
    const existing = store.signers().find((signer) => signer.id === id);
    if (existing)
      return c.json(
        {
          error:
            "Key already registered. Generate a new key to replace a revoked key.",
        },
        409,
      );
    const signer = store.saveSigner({
      id,
      ...input,
      source: "local",
      addedAt: new Date().toISOString(),
      revokedAt: null,
    });
    return c.json(signer, 201);
  });
  app.post("/api/signers/:id/revoke", (c) => {
    const signer = store
      .signers()
      .find((candidate) => candidate.id === c.req.param("id"));
    if (!signer) return c.json({ error: "Signer not found" }, 404);
    if (signer.source === "railway")
      return c.json(
        {
          error: "Rotate the coordinator signing key through Railway variables",
        },
        400,
      );
    return c.json(
      store.saveSigner({ ...signer, revokedAt: new Date().toISOString() }),
    );
  });
  app.post("/api/receipts", async (c) => {
    const receipt = receiptSchema.parse(await c.req.json());
    const signer = store
      .signers()
      .find(
        (candidate) =>
          candidate.id === receipt.claim.signerId &&
          candidate.source === "local",
      );
    const result = validateReceipt(receipt, signer, {
      repository: recipe.repository,
      tree: receipt.claim.tree,
      recipeDigest,
    });
    if (!result.valid) return c.json({ error: result.reason }, 400);
    const stored = store.saveReceipt({
      ...receipt,
      id: objectDigest(receipt),
      receivedAt: new Date().toISOString(),
      runId: null,
    });
    return c.json(stored, 201);
  });
  app.use("/api/internal/runs/:id/*", async (c, next) => {
    const run = store.getRun(c.req.param("id")!);
    const token = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
    if (!run || !sameSecret(digest(token), run.callbackHash))
      return c.json({ error: "Invalid runner credential" }, 401);
    await next();
  });
  app.get("/api/internal/runs/:id", (c) => {
    const run = store.getRun(c.req.param("id"))!;
    if (
      run.outcome ||
      run.recipeDigest !== recipeDigest ||
      Date.now() - Date.parse(run.allocatedAt ?? run.createdAt) >
        config.runTtlMs
    )
      return c.json({ error: "Run is no longer active" }, 409);
    return c.json({ recipe, commit: run.commit, tree: run.tree });
  });
  app.post("/api/internal/runs/:id/started", (c) => {
    const run = store.getRun(c.req.param("id"))!;
    if (run.outcome) return c.json({ error: "Run is no longer active" }, 409);
    store.updateRun(run.id, {
      status: "running",
      startedAt: run.startedAt ?? new Date().toISOString(),
    });
    return c.json({ ok: true });
  });
  app.post("/api/internal/runs/:id/complete", async (c) => {
    await coordinator.complete(
      c.req.param("id"),
      resultSchema.parse(await c.req.json()),
    );
    return c.json({ ok: true });
  });
  app.post("/api/internal/runs/:id/error", async (c) => {
    const input = z
      .object({ message: z.string().max(4000) })
      .strict()
      .parse(await c.req.json());
    coordinator.fail(c.req.param("id"), input.message);
    return c.json({ ok: true });
  });
  return app;
};
