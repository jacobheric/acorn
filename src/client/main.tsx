import {
  StrictMode,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Copy,
  FileCheck2,
  GitBranch,
  GitFork,
  KeyRound,
  Laptop,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Play,
  Plus,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  X,
} from "lucide-react";
import {
  isActive,
  type PublicRun,
  type Recipe,
  type Signer,
  type StoredReceipt,
  type Verification,
} from "../core/types.ts";
import "@fontsource-variable/dm-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "./style.css";

type Page = "overview" | "receipts" | "trust" | "about";
type State = {
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
const short = (value: string) => value.slice(0, 8);
const relative = (value: string) => {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 1000),
  );
  return seconds < 60
    ? "just now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`;
};
const duration = (start: string, end: string | null) => {
  const seconds = Math.max(
    0,
    Math.round(
      (Date.parse(end ?? new Date().toISOString()) - Date.parse(start)) / 1000,
    ),
  );
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
const statusLabel = (run: PublicRun) =>
  run.status === "stopping"
    ? "Removing container"
    : run.status === "starting"
      ? "Provisioning"
      : run.status === "timed_out"
        ? "Timed out"
        : run.status[0].toUpperCase() + run.status.slice(1);
const Logo = () => (
  <svg
    width="31"
    height="31"
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
  >
    <rect width="32" height="32" rx="9" fill="currentColor" />
    <path
      d="M9 11h7a5 5 0 0 1 0 10H9m0-5h14"
      stroke="var(--surface)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <path
      d="m20 13 3 3-3 3"
      stroke="var(--surface)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const Badge = ({
  tone = "",
  children,
}: {
  tone?: string;
  children: ReactNode;
}) => (
  <span className={`badge ${tone}`}>
    <span className="badge-dot" />
    {children}
  </span>
);
const Empty = ({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) => (
  <div className="empty">
    {icon}
    <h3>{title}</h3>
    <p>{children}</p>
  </div>
);

const App = () => {
  const [page, setPage] = useState<Page>("overview");
  const [data, setData] = useState<State | null>(null);
  const [token, setToken] = useState(
    () => sessionStorage.getItem("relay-operator") ?? "",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginToken, setLoginToken] = useState("");
  const [ref, setRef] = useState("main");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [verifyCommit, setVerifyCommit] = useState("");
  const [keyForm, setKeyForm] = useState(false);
  const [keyLabel, setKeyLabel] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const api = useCallback(
    async <T,>(
      path: string,
      body?: unknown,
      credential = token,
    ): Promise<T> => {
      const response = await fetch(`/api${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Request failed");
      return json as T;
    },
    [token],
  );
  const refresh = useCallback(
    async () => setData(await api<State>("/state")),
    [api],
  );
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = await api<State>("/state");
        if (!stopped) setData(state);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setNotice("Copied to clipboard");
  };
  const login = (e: FormEvent) => {
    e.preventDefault();
    void act("login", async () => {
      const result = await api<{ operator: boolean }>(
        "/session",
        undefined,
        loginToken,
      );
      if (!result.operator)
        throw new Error("That operator token was not accepted");
      sessionStorage.setItem("relay-operator", loginToken);
      setToken(loginToken);
      setLoginToken("");
      setLoginOpen(false);
    });
  };
  const start = () =>
    void act("start", async () => {
      const result = await api<{ run: PublicRun }>("/runs", {
        commit: ref.trim(),
        reason: "manual",
      });
      setSelectedRun(result.run.id);
      setNotice("Runner requested. Railway is provisioning the container.");
    });
  const active = data?.runs.find(isActive);
  const localReceipts =
    data?.receipts.filter(
      (receipt) =>
        data.signers.find((signer) => signer.id === receipt.claim.signerId)
          ?.source === "local",
    ) ?? [];
  const currentRun = data?.runs.find((run) => run.id === selectedRun);
  const currentReceipt = data?.receipts.find(
    (receipt) => receipt.id === selectedReceipt,
  );
  const nav = [
    { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
    { id: "receipts" as const, label: "Receipts", icon: FileCheck2 },
    { id: "trust" as const, label: "Trusted devices", icon: ShieldCheck },
    { id: "about" as const, label: "How it works", icon: CircleHelp },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
        >
          <Logo />
          <span>
            relay<span className="brand-period">.</span>
          </span>
          <span className="alpha">LAB</span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">J</span>
          <div>
            Personal workspace<small>jacobheric</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "selected" : ""}`}
              onClick={() => setPage(item.id)}
            >
              <item.icon size={18} />
              {item.label}
              {item.id === "receipts" && (
                <span className="nav-count">{data?.receipts.length ?? 0}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="built-on">
            <span className="railway-mark">≋</span>
            <div>
              Compute on Railway<small>Only when you need it.</small>
            </div>
          </div>
          <a
            className="source-link"
            href="https://github.com/jacobheric/railway"
            target="_blank"
            rel="noreferrer"
          >
            <GitFork size={16} /> View source <ArrowUpRight size={14} />
          </a>
          <button
            className="operator"
            onClick={() =>
              data?.operator
                ? (sessionStorage.removeItem("relay-operator"), setToken(""))
                : setLoginOpen(true)
            }
          >
            <span className="avatar">
              {data?.operator ? "JH" : <LockKeyhole size={15} />}
            </span>
            <div>
              {data?.operator ? "Jacob Heric" : "Visitor mode"}
              <small>
                {data?.operator ? "Operator access" : "Read-only access"}
              </small>
            </div>
            {data?.operator ? <LogOut size={15} /> : <KeyRound size={15} />}
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <ChevronRight size={13} />
            <span>{nav.find((item) => item.id === page)?.label}</span>
          </div>
          <div>
            <span className="live-dot" />
            {data ? "Live workspace" : "Connecting"}
            <span className="topbar-divider" />
            <a
              href={`https://github.com/${data?.repository ?? "jacobheric/railway-demo"}`}
              target="_blank"
              rel="noreferrer"
            >
              <GitFork size={15} />
              <span>railway-demo</span>
              <ArrowUpRight size={13} />
            </a>
          </div>
        </header>
        <main>
          {error && (
            <div className="alert" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {data?.providerError && (
            <div className="alert">
              Railway connection: {data.providerError}. Cleanup will retry.
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Check size={16} />
              {notice}
            </div>
          )}
          {page === "overview" && (
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
                    CI results that follow your code, from your laptop to the
                    pull request.
                    <br className="desktop-break" /> A fresh container when you
                    need one. A trusted receipt when you don’t.
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
                  <span className="graphic-caption">
                    THE WORK IS ALREADY DONE.
                  </span>
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
                  detail={
                    active
                      ? statusLabel(active)
                      : "All quiet. Nothing spinning."
                  }
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
                <button
                  className="text-button"
                  onClick={() => setPage("about")}
                >
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
                            setSelectedRun(
                              run.id === selectedRun ? null : run.id,
                            )
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
                                ? "Merge firewall"
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
                      Start an isolated container on Railway. Run the suite.
                      Keep the signed result.
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
                      <button
                        className="primary-button full"
                        onClick={() => setLoginOpen(true)}
                      >
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
                        Sign your result and publish a receipt. GitHub can
                        verify it without running CI again.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setPage("about")}
                      >
                        Set up your laptop <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </aside>
              </div>
            </>
          )}
          {page === "receipts" && (
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
                    <p>A signature records who vouched for the run.</p>
                  </div>
                  <Badge tone="neutral">
                    {data?.receipts.length ?? 0} receipts
                  </Badge>
                </div>
                {!data?.receipts.length ? (
                  <Empty
                    icon={<FileCheck2 size={30} />}
                    title="No receipts yet"
                  >
                    A successful Railway or local run creates the first one.
                  </Empty>
                ) : (
                  data.receipts.map((receipt) => {
                    const signer = data.signers.find(
                      (item) => item.id === receipt.claim.signerId,
                    );
                    const expired =
                      Date.now() - Date.parse(receipt.claim.startedAt) >
                      7 * 86400000;
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
                        <Badge
                          tone={signer?.revokedAt || expired ? "warning" : ""}
                        >
                          {signer?.revokedAt
                            ? "Revoked key"
                            : expired
                              ? "Expired"
                              : "Signed"}
                        </Badge>
                        <small className="muted">
                          {relative(receipt.receivedAt)}
                        </small>
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
                Receipts expire after 7 days. Revoking a device invalidates its
                receipts immediately.
              </p>
            </>
          )}
          {page === "trust" && (
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
                    <p>
                      Public keys live here. Private keys stay on the device.
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      data?.operator ? setKeyForm(!keyForm) : setLoginOpen(true)
                    }
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
                        {signer.source === "local"
                          ? "Local device"
                          : "Coordinator"}
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
                    The signature proves which key made the assertion and that
                    the result wasn’t altered. A trusted engineer can still lie
                    or have a compromised laptop. The independent merge run is a
                    second check.
                  </p>
                </div>
              </div>
            </>
          )}
          {page === "about" && (
            <>
              <PageHeading
                eyebrow="A SMALL CHANGE IN DIRECTION"
                title="Bring the result with you."
                description="Instead of asking a central queue to repeat every test, let trusted compute do the work once."
              />
              <div className="about-grid">
                <section className="panel about-steps">
                  <Step
                    n="01"
                    icon={<Laptop size={22} />}
                    title="Run the full suite locally"
                  >
                    Relay tests a committed snapshot in a pinned Linux
                    container. Your signing key stays outside the container.
                  </Step>
                  <Step
                    n="02"
                    icon={<FileCheck2 size={22} />}
                    title="Sign a receipt"
                  >
                    The receipt binds the source tree, CI recipe, result,
                    timestamps, and log digest to your device’s key.
                  </Step>
                  <Step
                    n="03"
                    icon={<GitFork size={22} />}
                    title="Let GitHub check the evidence"
                  >
                    A lightweight PR check verifies the receipt. Same tree, same
                    recipe, trusted signer: no repeat run.
                  </Step>
                  <Step
                    n="04"
                    icon={<Server size={22} />}
                    title="Use fresh compute where it counts"
                  >
                    Missing receipt? Request a Railway runner. Merge to main?
                    Run the full suite again, even if a receipt exists.
                  </Step>
                </section>
                <section className="panel getting-started">
                  <div className="panel-heading">
                    <div>
                      <h2>From your laptop</h2>
                      <p>Node 24+, Git, and Docker.</p>
                    </div>
                    <Terminal size={20} />
                  </div>
                  <pre>{`git clone https://github.com/jacobheric/railway\ncd railway && npm ci\n\n# Create a device key\nnpm run relay -- keygen\n\n# Register with operator access\nexport RELAY_URL=${window.location.origin}\nexport RELAY_ADMIN_TOKEN=<operator-token>\nnpm run relay -- register --label "My laptop"\nunset RELAY_ADMIN_TOKEN\n\n# Run before pushing\nnpm run relay -- run --repo ../railway-demo\n\n# Push, then publish the saved receipt\ngit -C ../railway-demo push\nnpm run relay -- publish /path/to/receipt.json`}</pre>
                  <a
                    className="text-button"
                    href="https://github.com/jacobheric/railway#readme"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Full setup guide <ArrowUpRight size={14} />
                  </a>
                </section>
              </div>
              <div className="principles">
                <div>
                  <GitBranch size={20} />
                  <h3>Hash the tree.</h3>
                  <p>
                    Commit-message amendments preserve the result. Any file edit
                    changes the tree. No comment parsing or fragile heuristics.
                  </p>
                </div>
                <div>
                  <LockKeyhole size={20} />
                  <h3>Keep the scope small.</h3>
                  <p>
                    One public demo repo, one active runner, a hard timeout. No
                    repository secrets are passed to test code.
                  </p>
                </div>
                <div>
                  <ArrowDownLeft size={20} />
                  <h3>Keep a second check.</h3>
                  <p>
                    The merge firewall runs independently on main. It detects
                    integration failures after merge; it is not a merge queue.
                  </p>
                </div>
              </div>
            </>
          )}
          <footer className="footer">
            <span>
              relay<span className="brand-period">.</span>
              <span>CI, with a little less waiting.</span>
            </span>
            <a
              href="https://github.com/jacobheric/railway"
              target="_blank"
              rel="noreferrer"
            >
              An experiment by Jacob Heric <ArrowUpRight size={13} />
            </a>
          </footer>
        </main>
      </div>
      {loginOpen && (
        <div className="modal-backdrop" onClick={() => setLoginOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-heading"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close-modal"
              aria-label="Close sign in"
              onClick={() => setLoginOpen(false)}
            >
              <X size={18} />
            </button>
            <span className="modal-icon">
              <KeyRound size={24} />
            </span>
            <h2 id="login-heading">Operator access</h2>
            <p>
              Use the operator token to start and stop runners or manage trusted
              devices.
            </p>
            <form onSubmit={login}>
              <label htmlFor="operator-token">Operator token</label>
              <input
                autoFocus
                id="operator-token"
                type="password"
                autoComplete="off"
                value={loginToken}
                onChange={(e) => setLoginToken(e.target.value)}
                required
              />
              <button className="primary-button full" disabled={Boolean(busy)}>
                Unlock workspace <ArrowRight size={15} />
              </button>
            </form>
            <small>The token stays in this browser tab’s session.</small>
          </section>
        </div>
      )}
    </div>
  );
};
const Stat = ({
  label,
  value,
  icon,
  detail,
  live,
}: {
  label: string;
  value: number | string;
  icon: ReactNode;
  detail: string;
  live?: boolean;
}) => (
  <div className={`stat-card ${live ? "active-stat" : ""}`}>
    <div>
      {label}
      {icon}
    </div>
    <strong>
      {value}
      {live && <span className="live-dot" />}
    </strong>
    <p>{detail}</p>
  </div>
);
const PageHeading = ({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) => (
  <div className="page-heading compact">
    <div>
      <div className="eyebrow">
        <span />
        {eyebrow}
      </div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  </div>
);
const Step = ({
  n,
  icon,
  title,
  children,
}: {
  n: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) => (
  <div className="about-step">
    <span className="step-number">{n}</span>
    <span className="step-icon">{icon}</span>
    <div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  </div>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
