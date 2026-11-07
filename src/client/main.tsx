import {
  StrictMode,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import type { Page, State } from "./types.ts";
import { Logo } from "./components.tsx";
import { OverviewPage } from "./OverviewPage.tsx";
import { ReceiptsPage } from "./ReceiptsPage.tsx";
import { TrustPage } from "./TrustPage.tsx";
import { AboutPage } from "./AboutPage.tsx";
import "@fontsource-variable/dm-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "./style.css";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  GitFork,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  X,
} from "lucide-react";
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
            <OverviewPage
              data={data}
              busy={busy}
              api={api}
              act={act}
              navigate={setPage}
              unlock={() => setLoginOpen(true)}
              notify={setNotice}
            />
          )}
          {page === "receipts" && (
            <ReceiptsPage
              data={data}
              busy={busy}
              api={api}
              act={act}
              copy={copy}
            />
          )}
          {page === "trust" && (
            <TrustPage
              data={data}
              busy={busy}
              api={api}
              act={act}
              unlock={() => setLoginOpen(true)}
            />
          )}
          {page === "about" && <AboutPage />}
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
