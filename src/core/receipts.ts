import { createHash, createPublicKey, sign, verify } from "node:crypto";
import {
  claimSchema,
  receiptSchema,
  type Claim,
  type Receipt,
  type Signer,
} from "./types.ts";

export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const objectDigest = (value: unknown) => digest(canonical(value));
export const keyId = (publicKey: string) => {
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Use an Ed25519 public key");
  return digest(key.export({ format: "der", type: "spki" }));
};
export const signReceipt = (claim: Claim, privateKey: string): Receipt => ({
  claim: claimSchema.parse(claim),
  signature: sign(null, Buffer.from(canonical(claim)), privateKey).toString(
    "base64",
  ),
});
export const validateReceipt = (
  input: unknown,
  signer: Signer | undefined,
  expected: { repository: string; tree: string; recipeDigest: string },
  now = Date.now(),
  maxAgeMs = 7 * 24 * 60 * 60 * 1_000,
): { valid: true; receipt: Receipt } | { valid: false; reason: string } => {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) return { valid: false, reason: "Malformed receipt" };
  const { claim, signature } = parsed.data;
  if (!signer || signer.revokedAt)
    return { valid: false, reason: "Signer is not trusted" };
  if (claim.signerId !== signer.id)
    return { valid: false, reason: "Signer does not match" };
  if (claim.repository !== expected.repository)
    return { valid: false, reason: "Repository changed" };
  if (claim.tree !== expected.tree)
    return { valid: false, reason: "Source tree changed" };
  if (claim.recipeDigest !== expected.recipeDigest)
    return { valid: false, reason: "CI recipe changed" };
  const start = Date.parse(claim.startedAt);
  const finish = Date.parse(claim.finishedAt);
  if (finish < start || finish > now + 30_000 || start > now + 30_000)
    return { valid: false, reason: "Invalid run time" };
  if (start < now - maxAgeMs)
    return { valid: false, reason: "Receipt expired" };
  try {
    if (
      keyId(signer.publicKey) !== signer.id ||
      !verify(
        null,
        Buffer.from(canonical(claim)),
        signer.publicKey,
        Buffer.from(signature, "base64"),
      )
    ) {
      return { valid: false, reason: "Invalid signature" };
    }
  } catch {
    return { valid: false, reason: "Invalid signature" };
  }
  return { valid: true, receipt: parsed.data };
};
