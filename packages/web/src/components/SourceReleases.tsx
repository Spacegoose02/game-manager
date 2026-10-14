import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type SourceRelease } from "../api";

const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

const meta = (r: SourceRelease) => [r.sourceName, day(r.date), ...Object.entries(r.details ?? {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(" · ");

/** Discover: what the admin's release sources have listed lately. Hidden when none are on. */
export function SourceReleases({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<SourceRelease[] | null>(null);
  useEffect(() => {
    api.sourceReleases(40).then(setItems, () => setItems([]));
  }, []);
  if (!items?.length) return null;
  return (
    <section className="row source-releases">
      <div className="row-head">
        <h2>From your sources</h2>
        {isAdmin && (
          <Link to="/settings/sources" className="muted small">
            Sources
          </Link>
        )}
      </div>
      <ul className="source-list">
        {items.map((r) => (
          <li key={r.id}>
            {r.image ? <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="source-blank">{r.title.slice(0, 1)}</span>}
            <span className="source-body">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" title={r.title}>
                  <strong>{r.title}</strong>
                </a>
              ) : (
                <strong title={r.title}>{r.title}</strong>
              )}
              <small className="muted" title={meta(r)}>
                {meta(r)}
              </small>
            </span>
            <Link className="button small ghost" to={`/discover?q=${encodeURIComponent(r.title)}`}>
              Look up
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
