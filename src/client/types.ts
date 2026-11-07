import type {
  PublicRun,
  Recipe,
  Signer,
  StoredReceipt,
} from "../core/types.ts";
export type Page = "overview" | "receipts" | "trust" | "about";
export type State = {
  runs: PublicRun[];
  receipts: StoredReceipt[];
  signers: Signer[];
  recipe: Recipe;
  recipeDigest: string;
  configured: boolean;
  providerError: string | null;
  repository: string;
  operator: boolean;
  receiptMaxAgeDays: number;
};

export type Actions = {
  data: State | null;
  busy: string;
  api: <T>(path: string, body?: unknown) => Promise<T>;
  act: (name: string, fn: () => Promise<void>) => Promise<void>;
};
