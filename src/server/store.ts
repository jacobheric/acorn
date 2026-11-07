import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Run, type Signer, type StoredReceipt } from "../core/types.ts";

export const createStore = (path: string) => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
    DROP INDEX IF EXISTS one_active_run;
    CREATE UNIQUE INDEX IF NOT EXISTS one_runner ON runs((1)) WHERE status IN ('starting', 'running', 'stopping');
    CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, tree TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS signers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  `);
  const parse = <T>(row: unknown): T | undefined =>
    row ? (JSON.parse((row as { data: string }).data) as T) : undefined;
  // signers are the trust store, so they are never truncated
  const list = <T>(table: "runs" | "receipts" | "signers"): T[] =>
    db
      .prepare(
        `SELECT data FROM ${table} ORDER BY rowid DESC${table === "signers" ? "" : " LIMIT 500"}`,
      )
      .all()
      .map((row) => parse<T>(row)!);
  const getRun = (id: string) =>
    parse<Run>(db.prepare("SELECT data FROM runs WHERE id = ?").get(id));
  const saveRun = (run: Run) => {
    db.prepare(
      "INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data",
    ).run(run.id, run.status, JSON.stringify(run));
    return run;
  };
  return {
    runs: () => list<Run>("runs"),
    activeRuns: () =>
      db
        .prepare(
          "SELECT data FROM runs WHERE status IN ('queued', 'starting', 'running', 'stopping') ORDER BY rowid",
        )
        .all()
        .map((row) => parse<Run>(row)!),
    receipts: () => list<StoredReceipt>("receipts"),
    signers: () => list<Signer>("signers"),
    getRun,
    saveRun,
    updateRun: (id: string, patch: Partial<Run>) => {
      const run = getRun(id);
      if (!run) throw new Error("Run not found");
      return saveRun({ ...run, ...patch, id: run.id });
    },
    saveReceipt: (receipt: StoredReceipt) => {
      db.prepare("INSERT OR IGNORE INTO receipts VALUES (?, ?, ?)").run(
        receipt.id,
        receipt.claim.tree,
        JSON.stringify(receipt),
      );
      return receipt;
    },
    receiptsForTree: (tree: string) =>
      db
        .prepare("SELECT data FROM receipts WHERE tree = ? ORDER BY rowid DESC")
        .all(tree)
        .map((row) => parse<StoredReceipt>(row)!),
    saveSigner: (signer: Signer) => {
      db.prepare(
        "INSERT INTO signers VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      ).run(signer.id, JSON.stringify(signer));
      return signer;
    },
    close: () => db.close(),
  };
};
export type Store = ReturnType<typeof createStore>;
