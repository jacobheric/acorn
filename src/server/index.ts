import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { config, recipe } from "./config.ts";
import { createCoordinator } from "./coordinator.ts";
import { createGithub } from "./github.ts";
import { createRailway } from "./railway.ts";
import { createStore } from "./store.ts";

if (
  process.env.NODE_ENV === "production" &&
  (!config.adminToken || !config.privateKey || !config.automationToken)
)
  throw new Error(
    "Set ADMIN_TOKEN, AUTOMATION_TOKEN and RECEIPT_PRIVATE_KEY before deploying",
  );
const store = createStore(config.database);
const github = createGithub(recipe, config.githubToken);
const provider = createRailway({
  token: config.railwayToken,
  projectId: config.projectId,
  environmentId: config.environmentId,
  publicUrl: config.publicUrl,
  recipe,
});
const coordinator = createCoordinator({
  store,
  provider,
  github,
  recipe,
  privateKey: config.privateKey,
  runTtlMs: config.runTtlMs,
});
const app = createApp({ store, coordinator, config, github });
app.get("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.get("*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));
const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: "0.0.0.0",
});
console.log(`Relay listening on :${config.port}`);
void coordinator.reconcile();
const interval = setInterval(() => void coordinator.reconcile(), 20_000);
const shutdown = () => {
  clearInterval(interval);
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
