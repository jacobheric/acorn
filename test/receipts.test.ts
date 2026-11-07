import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonical,
  digest,
  keyId,
  objectDigest,
  signReceipt,
  validateReceipt,
} from "../src/core/receipts.ts";
import type { Claim, Signer } from "../src/core/types.ts";

const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const now = Date.parse("2026-11-07T12:00:00.000Z");
const signer: Signer = {
  id: keyId(publicKey),
  label: "Laptop",
  publicKey,
  source: "local",
  addedAt: new Date(now).toISOString(),
  revokedAt: null,
};
const claim: Claim = {
  version: 1,
  repository: "jacobheric/acorn-demo",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  recipeDigest: digest("recipe"),
  signerId: signer.id,
  startedAt: new Date(now - 10_000).toISOString(),
  finishedAt: new Date(now).toISOString(),
  exitCode: 0,
  logDigest: digest("passed"),
};
const expected = {
  repository: claim.repository,
  tree: claim.tree,
  recipeDigest: claim.recipeDigest,
};
const receipt = signReceipt(claim, privateKey);

describe("signed CI receipts", () => {
  it("canonicalizes nested objects independently of insertion order", () => {
    expect(canonical({ z: 1, a: { c: 2, b: [3, 1] } })).toBe(
      '{"a":{"b":[3,1],"c":2},"z":1}',
    );
    expect(objectDigest({ a: 1, b: 2 })).toBe(objectDigest({ b: 2, a: 1 }));
  });
  it("accepts only one encoding of a signature", () => {
    const sig = receipt.signature;
    const last = "AQgw".indexOf(sig[85]);
    const variant = `${sig.slice(0, 85)}${"BRhx"[last]}==`;
    expect(Buffer.from(variant, "base64")).toEqual(Buffer.from(sig, "base64"));
    expect(
      validateReceipt({ ...receipt, signature: variant }, signer, expected, now)
        .valid,
    ).toBe(false);
  });
  it("accepts a trusted receipt for the same source and recipe", () =>
    expect(validateReceipt(receipt, signer, expected, now).valid).toBe(true));
  it("allows another commit with the same tree without rewriting the original claim", () => {
    expect(validateReceipt(receipt, signer, expected, now).valid).toBe(true);
    expect(receipt.claim.commit).toBe(claim.commit);
  });
  it.each([
    [
      "source change",
      { ...expected, tree: "c".repeat(40) },
      "Source tree changed",
    ],
    [
      "recipe change",
      { ...expected, recipeDigest: digest("new recipe") },
      "CI recipe changed",
    ],
    [
      "repository change",
      { ...expected, repository: "someone/else" },
      "Repository changed",
    ],
  ])("rejects %s", (_name, target, reason) =>
    expect(validateReceipt(receipt, signer, target, now)).toEqual({
      valid: false,
      reason,
    }),
  );
  it("rejects an altered claim with an unchanged signature", () => {
    expect(
      validateReceipt(
        { ...receipt, claim: { ...claim, logDigest: digest("forged") } },
        signer,
        expected,
        now,
      ),
    ).toEqual({ valid: false, reason: "Invalid signature" });
  });
  it("rejects revoked and unknown keys", () => {
    expect(
      validateReceipt(
        receipt,
        { ...signer, revokedAt: new Date(now).toISOString() },
        expected,
        now,
      ).valid,
    ).toBe(false);
    expect(validateReceipt(receipt, undefined, expected, now).valid).toBe(
      false,
    );
  });
  it("rejects a substituted public key", () => {
    const other = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    expect(
      validateReceipt(receipt, { ...signer, publicKey: other }, expected, now)
        .valid,
    ).toBe(false);
  });
  it("expires old receipts", () =>
    expect(
      validateReceipt(receipt, signer, expected, now + 8 * 86400000),
    ).toEqual({ valid: false, reason: "Receipt expired" }));
  it.each([
    {
      startedAt: new Date(now + 60_000).toISOString(),
      finishedAt: new Date(now + 70_000).toISOString(),
    },
    {
      startedAt: new Date(now).toISOString(),
      finishedAt: new Date(now - 1_000).toISOString(),
    },
  ])("rejects invalid time ranges", (times) =>
    expect(
      validateReceipt(
        signReceipt({ ...claim, ...times }, privateKey),
        signer,
        expected,
        now,
      ).valid,
    ).toBe(false),
  );
  it("rejects unknown claim fields and failed results", () => {
    expect(
      validateReceipt(
        { ...receipt, claim: { ...claim, extra: "ignored?" } },
        signer,
        expected,
        now,
      ).valid,
    ).toBe(false);
    expect(
      validateReceipt(
        { ...receipt, claim: { ...claim, exitCode: 1 } },
        signer,
        expected,
        now,
      ).valid,
    ).toBe(false);
  });
});
