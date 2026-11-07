import { generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const { privateKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const variables = {
  ADMIN_TOKEN: randomBytes(32).toString("base64url"),
  AUTOMATION_TOKEN: randomBytes(32).toString("base64url"),
  RECEIPT_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"),
  PUBLIC_URL: "http://localhost:3000",
  DATABASE_PATH: "./data/acorn.sqlite",
};
await writeFile(
  ".env",
  Object.entries(variables)
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n") + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Created .env with operator, automation, and signing credentials. Keep this file private.",
);
