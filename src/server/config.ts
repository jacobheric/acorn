import { recipeSchema } from "../core/types.ts";
import { objectDigest } from "../core/receipts.ts";

export const recipe = recipeSchema.parse({
  version: 1,
  repository: process.env.DEMO_REPOSITORY ?? "jacobheric/acorn-demo",
  image:
    "node:24-bookworm@sha256:6b9d4ea31e614e29f364bf75758458731eb1e105b80c99667438dd6b3fe262e0",
  platform: "linux/amd64",
  command: ["npm", "test"],
  environment: { CI: "true", TZ: "UTC", LANG: "C.UTF-8" },
  timeoutSeconds: 180,
});
export const recipeDigest = objectDigest(recipe);
export const config = {
  port: Number(process.env.PORT ?? 3000),
  database: process.env.DATABASE_PATH ?? "./data/acorn.sqlite",
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  ),
  adminToken: process.env.ADMIN_TOKEN ?? "",
  automationToken: process.env.AUTOMATION_TOKEN ?? "",
  privateKey: process.env.RECEIPT_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? "",
  railwayToken: process.env.RAILWAY_API_TOKEN ?? "",
  projectId: process.env.RUNNER_PROJECT_ID ?? "",
  environmentId: process.env.RUNNER_ENVIRONMENT_ID ?? "",
  githubToken: process.env.GITHUB_READ_TOKEN ?? "",
  runTtlMs: 10 * 60 * 1_000,
};
