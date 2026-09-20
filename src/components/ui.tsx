/** Shared surfaces for the STAMPPAD interface. Presentation only. */

type PanelTone = "paper" | "ink" | "sage";

export function Panel({
  children,
  tone = "paper",
  quiet = false,
  className = "",
  bodyClassName = "",
}: {
  children: React.ReactNode;
  tone?: PanelTone;
  quiet?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  const toneClass = tone === "ink" ? " panel--ink" : tone === "sage" ? " panel--sage" : "";
  return (
    <section className={`panel stepped${toneClass}${quiet ? " panel--quiet" : ""} ${className}`}>
      <div className={`panel__in ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function PanelHead({
  title,
  action,
  id,
}: {
  title: string;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="panel__head">
      <h2 id={id}>{title}</h2>
      {action}
    </div>
  );
}

export function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="spread">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function Note({
  children,
  tone = "info",
  title,
}: {
  children: React.ReactNode;
  tone?: "info" | "warn" | "error" | "quiet";
  title?: string;
}) {
  const cls = tone === "info" ? "" : ` note--${tone}`;
  return (
    <div className={`note${cls}`} role={tone === "error" ? "alert" : undefined}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
  state,
}: {
  children: React.ReactNode;
  tone?: "default" | "live" | "solid" | "onink" | "flag";
  state?: string;
}) {
  const toneClass = tone === "default" ? "" : ` badge--${tone}`;
  const stateClass = state ? ` is-${state}` : "";
  return <span className={`badge${toneClass}${stateClass}`}>{children}</span>;
}

/** Collapsible home for flags, replay mechanics, decimals and raw identifiers. */
export function Tech({
  children,
  summary = "Technical details",
}: {
  children: React.ReactNode;
  summary?: string;
}) {
  return (
    <details className="tech">
      <summary>{summary}</summary>
      <div className="tech__body">{children}</div>
    </details>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="tiny muted">{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="stack-sm" aria-busy="true" aria-live="polite">
      <span className="eyebrow">{label}…</span>
      <div className="skeleton" style={{ width: "60%" }} />
      <div className="skeleton" style={{ width: "85%" }} />
      <div className="skeleton" style={{ width: "40%" }} />
    </div>
  );
}
