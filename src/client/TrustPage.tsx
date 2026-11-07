import { useState } from "react";
import { Laptop, Plus, Server, ShieldCheck } from "lucide-react";
import type { Actions } from "./types.ts";
import { PageHeading, Badge, short } from "./components.tsx";

export const TrustPage = ({
  data,
  busy,
  api,
  act,
  unlock,
}: Actions & { unlock: () => void }) => {
  const [keyForm, setKeyForm] = useState(false);
  const [keyLabel, setKeyLabel] = useState("");
  const [publicKey, setPublicKey] = useState("");
  return (
    <>
      <PageHeading
        eyebrow="EXPLICIT TRUST"
        title="Know who ran it."
        description="Only registered Ed25519 keys can vouch for a local run. Revoke a key to stop trusting its results."
      />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Trusted devices</h2>
            <p>Public keys live here. Private keys stay on the device.</p>
          </div>
          <button
            className="secondary-button"
            onClick={() => (data?.operator ? setKeyForm(!keyForm) : unlock())}
          >
            <Plus size={15} />
            Add device
          </button>
        </div>
        {keyForm && (
          <form
            className="key-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act("add-key", async () => {
                await api("/signers", { label: keyLabel, publicKey });
                setKeyForm(false);
                setKeyLabel("");
                setPublicKey("");
              });
            }}
          >
            <label>
              Device name
              <input
                required
                value={keyLabel}
                onChange={(e) => setKeyLabel(e.target.value)}
                placeholder="Jacob’s laptop"
                maxLength={60}
              />
            </label>
            <label>
              Ed25519 public key
              <textarea
                required
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                placeholder="-----BEGIN PUBLIC KEY-----"
                rows={3}
              />
            </label>
            <button className="primary-button" disabled={Boolean(busy)}>
              Trust this device
            </button>
          </form>
        )}
        {data?.signers.map((signer) => (
          <div key={signer.id} className="signer-row">
            <span className="receipt-icon">
              {signer.source === "local" ? (
                <Laptop size={21} />
              ) : (
                <Server size={21} />
              )}
            </span>
            <div className="run-title">
              <strong>{signer.label}</strong>
              <small>
                <code>{short(signer.id)}</code>
                <span>·</span>Ed25519<span>·</span>
                {signer.source === "local" ? "Local device" : "Coordinator"}
              </small>
            </div>
            <Badge tone={signer.revokedAt ? "warning" : ""}>
              {signer.revokedAt ? "Revoked" : "Trusted"}
            </Badge>
            {signer.source === "local" &&
              !signer.revokedAt &&
              data.operator && (
                <button
                  className="text-button danger"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act("revoke", async () => {
                      await api(`/signers/${signer.id}/revoke`, {});
                    })
                  }
                >
                  Revoke
                </button>
              )}
          </div>
        ))}
      </section>
      <div className="trust-explainer">
        <ShieldCheck size={22} />
        <div>
          <h3>A trust model, not a proof of execution.</h3>
          <p>
            The signature proves which key made the assertion and that the
            result wasn’t altered. A trusted engineer can still lie or have a
            compromised laptop. The independent merge run is a second check.
          </p>
        </div>
      </div>
    </>
  );
};
