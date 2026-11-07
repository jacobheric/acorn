import { useState } from "react";
import {
  ChevronRight,
  Copy,
  FileCheck2,
  Laptop,
  Server,
  ShieldCheck,
} from "lucide-react";
import type { Verification } from "../core/types.ts";
import type { Actions } from "./types.ts";
import { PageHeading, Badge, Empty, short, relative } from "./components.tsx";

export const ReceiptsPage = ({
  data,
  busy,
  api,
  act,
  copy,
}: Actions & { copy: (value: string) => Promise<void> }) => {
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [verifyCommit, setVerifyCommit] = useState("");
  const currentReceipt = data?.receipts.find(
    (receipt) => receipt.id === selectedReceipt,
  );
  return (
    <>
      <PageHeading
        eyebrow="EVIDENCE, NOT REPETITION"
        title="The result stays."
        description="Signed results for exact source trees. A new commit message can keep the same receipt."
      />
      <div className="panel verify-panel">
        <div>
          <h2>Check a commit</h2>
          <p>Verify the source, recipe, trusted key, and age.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act("verify", async () =>
              setVerification(
                await api<Verification>(
                  `/verify?commit=${encodeURIComponent(verifyCommit)}`,
                ),
              ),
            );
          }}
        >
          <input
            aria-label="Commit SHA to verify"
            value={verifyCommit}
            onChange={(e) => setVerifyCommit(e.target.value)}
            placeholder="Full 40-character commit SHA"
            pattern="[a-f0-9]{40}"
            required
          />
          <button className="primary-button" disabled={Boolean(busy)}>
            <ShieldCheck size={16} /> Verify
          </button>
        </form>
        {verification && (
          <div
            className={`verification-result ${verification.verified ? "valid" : "invalid"}`}
          >
            <ShieldCheck size={19} />
            <div>
              <strong>
                {verification.verified
                  ? "Receipt verified"
                  : "Fresh CI required"}
              </strong>
              <p>
                {verification.reason}
                {verification.reused
                  ? ". Reused across commits with the same tree."
                  : ""}
              </p>
            </div>
          </div>
        )}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Receipt ledger</h2>
            <p>
              A signature records who vouched for the run. Source matching is
              checked when a commit is verified.
            </p>
          </div>
          <Badge tone="neutral">{data?.receipts.length ?? 0} receipts</Badge>
        </div>
        {!data?.receipts.length ? (
          <Empty icon={<FileCheck2 size={30} />} title="No receipts yet">
            A successful Railway or local run creates the first one.
          </Empty>
        ) : (
          data.receipts.map((receipt) => {
            const signer = data.signers.find(
              (item) => item.id === receipt.claim.signerId,
            );
            const expired =
              Date.now() - Date.parse(receipt.claim.startedAt) > 7 * 86400000;
            return (
              <button
                key={receipt.id}
                className="receipt-row"
                onClick={() =>
                  setSelectedReceipt(
                    receipt.id === selectedReceipt ? null : receipt.id,
                  )
                }
              >
                <span className="receipt-icon">
                  {signer?.source === "local" ? (
                    <Laptop size={20} />
                  ) : (
                    <Server size={20} />
                  )}
                </span>
                <div className="run-title">
                  <strong>{signer?.label ?? "Unknown signer"}</strong>
                  <small>
                    <code>{short(receipt.claim.tree)}</code>
                    <span>·</span>source tree
                  </small>
                </div>
                <code className="receipt-id">{short(receipt.id)}</code>
                <Badge tone={signer?.revokedAt || expired ? "warning" : ""}>
                  {signer?.revokedAt
                    ? "Revoked key"
                    : expired
                      ? "Expired"
                      : "Signed"}
                </Badge>
                <small className="muted">{relative(receipt.receivedAt)}</small>
                <ChevronRight size={15} />
              </button>
            );
          })
        )}
        {currentReceipt && (
          <div className="receipt-detail">
            <div className="detail-heading">
              <strong>Signed envelope</strong>
              <button
                className="text-button"
                onClick={() =>
                  void copy(
                    JSON.stringify(
                      {
                        claim: currentReceipt.claim,
                        signature: currentReceipt.signature,
                      },
                      null,
                      2,
                    ),
                  )
                }
              >
                <Copy size={14} />
                Copy JSON
              </button>
            </div>
            <pre>
              {JSON.stringify(
                {
                  claim: currentReceipt.claim,
                  signature: currentReceipt.signature,
                },
                null,
                2,
              )}
            </pre>
          </div>
        )}
      </section>
      <p className="footnote">
        Receipts expire after 7 days. Revoking a device invalidates its receipts
        immediately.
      </p>
    </>
  );
};
