import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Connectors } from "../api";

/** One settings card: a title, a sentence on what it's for, the fields, then its buttons on the right. */
export function Card({ title, description, actions, status, children, id }: { title: string; description?: ReactNode; actions?: ReactNode; status?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <section className="settings-card" id={id}>
      <header>
        <div>
          <h2>{title}</h2>
          {description && <p className="muted small">{description}</p>}
        </div>
        {status && <div className="settings-status">{status}</div>}
      </header>
      {children && <div className="settings-body">{children}</div>}
      {actions && <footer className="settings-actions">{actions}</footer>}
    </section>
  );
}

/** A labelled field with an optional hint under it. */
export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? " wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** An on/off switch with a label and a hint. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <small className="muted">{hint}</small>}
      </span>
      <span className="switch">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}

/** "Connected", "Not set up" and friends. */
export function Pill({ tone, children }: { tone: "good" | "warn" | "bad" | "muted"; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

/**
 * The download, import, scan and alert settings, loaded once and shared by the cards that edit
 * them. Each card saves the whole set; secrets come back masked and stay as they were.
 */
export function useConnectors(onMessage: (m: string, error?: boolean) => void) {
  const [c, setC] = useState<Connectors | null>(null);
  const [busy, setBusy] = useState(false);
  const report = useRef(onMessage);
  report.current = onMessage;
  useEffect(() => {
    api.connectors().then(setC, (e: Error) => report.current(e.message, true));
  }, []);
  const set = <K extends keyof Connectors>(k: K, patch: Connectors[K] extends object ? Partial<Connectors[K]> : Connectors[K]) =>
    setC((cur) => (cur ? { ...cur, [k]: typeof patch === "object" && !Array.isArray(patch) ? { ...(cur[k] as object), ...(patch as object) } : patch } : cur));
  const save = async (done = "Saved", extra?: () => Promise<string>) => {
    if (!c) return;
    setBusy(true);
    try {
      setC(await api.saveConnectors(c));
      report.current(extra ? await extra() : done);
    } catch (e) {
      report.current((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const test = (name: string) => save("", async () => `${(await api.testConnector(name)).message} is reachable`);
  return { c, set, save, test, busy };
}
