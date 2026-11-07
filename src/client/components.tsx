import type { ReactNode } from "react";
import type { PublicRun } from "../core/types.ts";
export const short = (value: string) => value.slice(0, 8);
export const relative = (value: string) => {
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
export const duration = (start: string, end: string | null) => {
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
export const statusLabel = (run: PublicRun) =>
  run.status === "stopping"
    ? "Removing container"
    : run.status === "starting"
      ? "Provisioning"
      : run.status === "timed_out"
        ? "Timed out"
        : run.status[0].toUpperCase() + run.status.slice(1);
export const Logo = () => (
  <img src="/favicon.svg" width="31" height="31" alt="" aria-hidden="true" />
);
export const Badge = ({
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
export const Empty = ({
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

export const Stat = ({
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
export const PageHeading = ({
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
export const Step = ({
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
