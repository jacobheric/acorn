import { z } from "zod";

export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const repositorySchema = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);

export const recipeSchema = z
  .object({
    version: z.literal(1),
    repository: repositorySchema,
    image: z.string().regex(/^node:[a-zA-Z0-9.-]+@sha256:[a-f0-9]{64}$/),
    platform: z.literal("linux/amd64"),
    command: z.array(z.string().min(1)).min(1),
    environment: z.record(z.string(), z.string()),
    timeoutSeconds: z.number().int().min(1).max(600),
  })
  .strict();
export type Recipe = z.infer<typeof recipeSchema>;

export const claimSchema = z
  .object({
    version: z.literal(1),
    repository: repositorySchema,
    commit: shaSchema,
    tree: shaSchema,
    recipeDigest: digestSchema,
    signerId: digestSchema,
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    exitCode: z.literal(0),
    logDigest: digestSchema,
  })
  .strict();

export const receiptSchema = z
  .object({
    claim: claimSchema,
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();

export type Claim = z.infer<typeof claimSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Signer = {
  id: string;
  label: string;
  publicKey: string;
  source: "local" | "railway";
  addedAt: string;
  revokedAt: string | null;
};
export type StoredReceipt = Receipt & {
  id: string;
  receivedAt: string;
  runId: string | null;
};
export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "stopping"
  | "passed"
  | "failed"
  | "cancelled"
  | "timed_out";
export type Run = {
  id: string;
  repository: string;
  commit: string;
  tree: string;
  message: string;
  status: RunStatus;
  outcome: "passed" | "failed" | "cancelled" | "timed_out" | null;
  reason: "manual" | "fallback" | "firewall";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  serviceId: string | null;
  deploymentId: string | null;
  cleanupAt: string | null;
  cleanupError: string | null;
  callbackHash: string;
  receiptId: string | null;
  logs: string;
  error: string | null;
};
export type PublicRun = Omit<Run, "callbackHash">;
export const activeStatuses: RunStatus[] = [
  "queued",
  "starting",
  "running",
  "stopping",
];
export const isActive = (run: Pick<Run, "status">) =>
  activeStatuses.includes(run.status);
export type Verification = {
  verified: boolean;
  reason: string;
  commit: string;
  tree: string;
  recipeDigest: string;
  receipt: StoredReceipt | null;
  signer: Signer | null;
  reused: boolean;
};
