import { useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  FileCheck2,
  GitBranch,
  KeyRound,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  Play,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { isActive, type PublicRun } from "../core/types.ts";
import type { Actions, Page } from "./types.ts";
import {
  Stat,
  Badge,
  Empty,
  short,
  relative,
  duration,
  statusLabel,
} from "./components.tsx";

export const OverviewPage = ({
  data,
  busy,
  api,
  act,
  navigate,
  unlock,
  notify,
}: Actions & {
  navigate: (page: Page) => void;
  unlock: () => void;
  notify: (message: string) => void;
}) => {
  const [ref, setRef] = useState("main");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const active =
    data?.runs.find((run) => isActive(run) && run.status !== "queued") ??
    data?.runs.find(isActive);
  const currentRun = data?.runs.find((run) => run.id === selectedRun);
  const localReceipts =
    data?.receipts.filter(
      (receipt) =>
        data.signers.find((signer) => signer.id === receipt.claim.signerId)
          ?.source === "local",
    ) ?? [];
  const start = () =>
    void act("start", async () => {
      const result = await api<{ run: PublicRun }>("/runs", {
        commit: ref.trim(),
        reason: "manual",
      });
      setSelectedRun(result.run.id);
      notify("Run queued. Relay starts it when the runner is available.");
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> LESS WAITING. MORE SHIPPING.
          </div>
          <h1>
            Run once.
            <br />
            <span>Carry the result.</span>
          </h1>
          <p>
            CI results that follow your code, from your laptop to the pull
            request.
            <br className="desktop-break" /> A fresh container when you need
            one. A trusted receipt when you don’t.
          </p>
        </div>
        <div className="heading-graphic" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="graphic-node node-laptop">
            <Laptop size={23} />
          </div>
          <div className="graphic-node node-check">
            <CheckCheck size={31} />
          </div>
          <div className="graphic-node node-cloud">
            <Server size={22} />
          </div>
          <span className="graphic-caption">THE WORK IS ALREADY DONE.</span>
        </div>
      </div>
      <div className="stats-grid">
        <Stat
          label="Signed receipts"
          value={data?.receipts.length ?? "—"}
          icon={<FileCheck2 size={17} />}
          detail="Ready to verify"
        />
        <Stat
          label="From your laptop"
          value={localReceipts.length}
          icon={<Laptop size={17} />}
          detail="No remote runner needed"
        />
        <Stat
          label="Railway runs"
          value={data?.runs.length ?? "—"}
          icon={<Server size={17} />}
          detail="Fresh, disposable compute"
        />
        <Stat
          label="Active runners"
          value={data?.runs.filter(isActive).length ?? "—"}
          icon={<Activity size={17} />}
          detail={active ? statusLabel(active) : "All quiet. Nothing spinning."}
          live={Boolean(active)}
        />
      </div>
      <section className="flow-strip" aria-label="How Relay routes CI">
        <div className="flow-step">
          <span className="flow-icon">
            <GitBranch size={18} />
          </span>
          <div>
            Push your code<small>Exact source tree</small>
          </div>
        </div>
        <ArrowRight className="flow-arrow" size={19} />
        <div className="flow-step">
          <span className="flow-icon green">
            <ShieldCheck size={18} />
          </span>
          <div>
            Check the receipt<small>Source + recipe + signer</small>
          </div>
        </div>
        <ArrowRight className="flow-arrow" size={19} />
        <div className="flow-step">
          <span className="flow-icon green">
            <Check size={18} />
          </span>
          <div>
            Keep moving<small>Or start a Railway runner</small>
          </div>
        </div>
        <button className="text-button" onClick={() => navigate("about")}>
          The idea <ArrowUpRight size={14} />
        </button>
      </section>
      <div className="work-grid">
        <section className="panel history-panel">
          <div className="panel-heading">
            <div>
              <h2>Execution history</h2>
              <p>Fresh runs, from spin-up to cleanup.</p>
            </div>
            <Badge tone="neutral">{data?.runs.length ?? 0} runs</Badge>
          </div>
          {!data?.runs.length ? (
            <Empty
              icon={<Terminal size={28} />}
              title="Your first run starts here"
            >
              Spin up a runner to test the sample app.
              <br />
              The container goes away. The result stays.
            </Empty>
          ) : (
            <div className="run-list">
              {data.runs.slice(0, 12).map((run) => (
                <button
                  className={`run-row ${run.id === selectedRun ? "chosen" : ""}`}
                  key={run.id}
                  onClick={() =>
                    setSelectedRun(run.id === selectedRun ? null : run.id)
                  }
                >
                  <span className={`run-status-icon ${run.status}`}>
                    {isActive(run) ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : run.status === "passed" ? (
                      <Check size={17} />
                    ) : run.status === "cancelled" ? (
                      <Square size={14} />
                    ) : (
                      <X size={17} />
                    )}
                  </span>
                  <div className="run-title">
                    <strong>{run.message || "CI run"}</strong>
                    <small>
                      <GitBranch size={12} />
                      {short(run.commit)}
                      <span>·</span>
                      {run.reason === "firewall"
                        ? "Merge gate"
                        : run.reason === "fallback"
                          ? "GitHub fallback"
                          : "Manual run"}
                    </small>
                  </div>
                  <div className="run-meta">
                    <span className={`status-text ${run.status}`}>
                      {statusLabel(run)}
                    </span>
                    <small>
                      {relative(run.createdAt)}
                      <span>·</span>
                      {duration(run.createdAt, run.finishedAt)}
                    </small>
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          )}
          {currentRun && (
            <div className="run-details">
              <div className="detail-heading">
                <strong>Run details</strong>
                <code>{short(currentRun.id)}</code>
                {isActive(currentRun) && data?.operator && (
                  <button
                    className="text-button danger"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act("stop", async () => {
                        await api(`/runs/${currentRun.id}/stop`, {});
                      })
                    }
                  >
                    <Square size={12} /> Stop
                  </button>
                )}
              </div>
              <div className="detail-grid">
                <span>
                  Source tree<code>{short(currentRun.tree)}</code>
                </span>
                <span>
                  Container
                  <code>
                    {currentRun.cleanupAt
                      ? "removed"
                      : currentRun.serviceId
                        ? "provisioned"
                        : "requested"}
                  </code>
                </span>
                <span>
                  Receipt
                  <code>
                    {currentRun.receiptId
                      ? short(currentRun.receiptId)
                      : "pending"}
                  </code>
                </span>
              </div>
              {currentRun.error && (
                <p className="error-text">{currentRun.error}</p>
              )}
              {currentRun.cleanupError && (
                <p className="error-text">
                  Cleanup retry: {currentRun.cleanupError}
                </p>
              )}
              <pre className="terminal">
                <span className="terminal-label">$ npm test</span>
                {currentRun.logs ||
                  (currentRun.status === "running"
                    ? "CI is running. Output will appear when the suite finishes."
                    : "Waiting for runner output…")}
              </pre>
            </div>
          )}
          <div className="panel-footer">
            <span className="live-dot" /> Updates every 4 seconds{" "}
            <span>1 runner at a time · 10 minute lease</span>
          </div>
        </section>
        <aside className="control-stack">
          <section className="panel runner-control">
            <div className="panel-heading">
              <div>
                <div className="section-kicker">ON-DEMAND COMPUTE</div>
                <h2>Need a fresh run?</h2>
              </div>
              <Server size={20} />
            </div>
            <p className="control-description">
              Start an isolated container on Railway. Run the suite. Keep the
              signed result.
            </p>
            <label className="field-label" htmlFor="commit-ref">
              Branch or commit
            </label>
            <div className="input-with-icon">
              <GitBranch size={15} />
              <input
                id="commit-ref"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="main or full commit SHA"
                disabled={Boolean(active)}
              />
            </div>
            <div className="runner-spec">
              <span>
                Runtime
                <strong>
                  Node 24 <small>linux/amd64</small>
                </strong>
              </span>
              <span>
                Command<code>npm test</code>
              </span>
              <span>
                Restart policy<strong>Never</strong>
              </span>
              <span>
                After completion<strong>Container removed</strong>
              </span>
            </div>
            {!data?.operator ? (
              <button className="primary-button full" onClick={() => unlock()}>
                <KeyRound size={15} /> Unlock runner controls
              </button>
            ) : active ? (
              <button
                className="stop-button full"
                disabled={Boolean(busy) || active.status === "stopping"}
                onClick={() =>
                  void act("stop", async () => {
                    await api(`/runs/${active.id}/stop`, {});
                  })
                }
              >
                {active.status === "stopping" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Square size={14} />
                )}{" "}
                {active.status === "stopping"
                  ? "Removing container…"
                  : "Spin down runner"}
              </button>
            ) : (
              <button
                className="primary-button full"
                disabled={Boolean(busy) || !data.configured}
                onClick={start}
              >
                {busy === "start" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Play size={15} />
                )}
                Spin up runner
                <ArrowUpRight size={16} />
              </button>
            )}
            <p className="control-note">
              <LockKeyhole size={12} />
              {data?.configured
                ? "Only the configured demo repo can run."
                : "Runner credentials are not configured yet."}
            </p>
          </section>
          <div className="local-note">
            <span className="note-icon">
              <Laptop size={19} />
            </span>
            <div>
              <h3>Already tested locally?</h3>
              <p>
                Sign your result and publish a receipt. GitHub can verify it
                without running CI again.
              </p>
              <button className="text-button" onClick={() => navigate("about")}>
                Set up your laptop <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
};
