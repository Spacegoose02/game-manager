import { useEffect, useState } from "react";
import { api, BACKLOG, BACKLOG_LABELS, type BacklogStatus, type Journal, type NexusMod, type TimeToBeat, type VersionCheck } from "../api";

const SOURCE: Record<string, string> = { gog: "GOG", steam: "Steam", itch: "itch.io" };

/** "Update available" when this copy is behind the store; admins can check on demand. */
export function VersionBanner({ gameId, isAdmin }: { gameId: string; isAdmin: boolean }) {
  const [v, setV] = useState<VersionCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setV(null);
    api.version(gameId).then(setV, () => {});
  }, [gameId]);
  const check = async () => {
    setBusy(true);
    setError("");
    try {
      setV(await api.checkVersion(gameId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!v && !isAdmin) return null;
  return (
    <div className={`version-line${v?.behind ? " behind" : ""}`}>
      {v?.behind ? (
        <span>
          <strong>Update available</strong>
          {v.latest ? ` · ${v.latest.match(/^\d/) ? "v" : ""}${v.latest}` : ""} on {SOURCE[v.source ?? ""] ?? "the store"}
          {v.current ? ` (this copy is v${v.current})` : ""}
          {v.url && (
            <>
              {" · "}
              <a href={v.url} target="_blank" rel="noreferrer">
                What changed
              </a>
            </>
          )}
        </span>
      ) : v ? (
        <small className="muted">
          {v.current ? `v${v.current} · ` : ""}
          {v.detail} · checked {new Date(v.checkedAt).toLocaleDateString()}
        </small>
      ) : (
        <small className="muted">Not checked for updates yet</small>
      )}
      {isAdmin && (
        <button className="ghost small" disabled={busy} onClick={() => void check()}>
          {busy ? "Checking…" : "Check for updates"}
        </button>
      )}
      {error && <small className="error">{error}</small>}
    </div>
  );
}

const hrs = (h: number | null) => (h == null ? "–" : `${h} h`);

/** The player's own backlog status, rating, notes and dated journal, plus Time to Beat. */
export function JournalPanel({ gameId }: { gameId: string }) {
  const [j, setJ] = useState<Journal | null>(null);
  const [ttb, setTtb] = useState<TimeToBeat | null | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [entry, setEntry] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api.journal(gameId).then((x) => {
      setJ(x);
      setNotes(x.notes);
    }, () => setJ(null));
    api.timeToBeat(gameId).then(setTtb, () => setTtb(null));
  }, [gameId]);
  if (!j) return null;
  const save = async (fn: () => Promise<Journal>) => {
    setError("");
    try {
      const x = await fn();
      setJ(x);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="panel journal">
      <div className="journal-head">
        <h2>My journal</h2>
        {ttb && (ttb.main || ttb.normally || ttb.completely) ? (
          <div className="ttb" title={`From ${ttb.count} IGDB players`}>
            <span>
              <small className="muted">Main story</small>
              <strong>{hrs(ttb.main)}</strong>
            </span>
            <span>
              <small className="muted">Main + extras</small>
              <strong>{hrs(ttb.normally)}</strong>
            </span>
            <span>
              <small className="muted">Completionist</small>
              <strong>{hrs(ttb.completely)}</strong>
            </span>
          </div>
        ) : null}
      </div>
      <div className="segmented wrap" role="radiogroup" aria-label="Status">
        {BACKLOG.map((s) => (
          <button key={s} role="radio" aria-checked={j.status === s} className={j.status === s ? "active" : ""} onClick={() => void save(() => api.saveJournal(gameId, { status: j.status === s ? null : (s as BacklogStatus) }))}>
            {BACKLOG_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="stars" role="radiogroup" aria-label="My rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={j.rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} className={j.rating && n <= j.rating ? "on" : ""} onClick={() => void save(() => api.saveJournal(gameId, { rating: j.rating === n ? null : n }))}>
            ★
          </button>
        ))}
      </div>
      <label className="field wide">
        <span className="field-label">Notes</span>
        <textarea rows={3} value={notes} placeholder="Where you are, what to try next, codes…" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== j.notes && void save(() => api.saveJournal(gameId, { notes }))} />
      </label>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (!entry.trim()) return;
          void save(() => api.addJournalEntry(gameId, entry)).then(() => setEntry(""));
        }}
      >
        <input placeholder="Add a dated entry: what happened this session" value={entry} onChange={(e) => setEntry(e.target.value)} style={{ flex: 1 }} />
        <button disabled={!entry.trim()}>Add</button>
      </form>
      {error && <p className="error small">{error}</p>}
      {j.entries.length > 0 && (
        <ul className="journal-entries">
          {j.entries.map((e) => (
            <li key={e.id}>
              <small className="muted">{new Date(e.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</small>
              <p>{e.text}</p>
              <button className="ghost small" aria-label="Delete entry" onClick={() => void api.deleteJournalEntry(e.id).then(() => api.journal(gameId).then(setJ))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Trending NexusMods mods for this game (needs a NexusMods key in Settings). */
export function ModsPanel({ gameId }: { gameId: string }) {
  const [data, setData] = useState<{ domain: string | null; mods: NexusMod[] } | null>(null);
  useEffect(() => {
    setData(null);
    api.mods(gameId).then(setData, () => setData(null));
  }, [gameId]);
  if (!data?.mods.length) return null;
  return (
    <section className="row mods">
      <div className="inline" style={{ justifyContent: "space-between" }}>
        <h2>Trending mods</h2>
        <a className="small" href={`https://www.nexusmods.com/${data.domain}/mods/trending`} target="_blank" rel="noreferrer">
          More on NexusMods
        </a>
      </div>
      <div className="row-track mod-track">
        {data.mods.map((m) => (
          <a key={m.id} className="mod-card" href={m.url} target="_blank" rel="noreferrer">
            {m.picture ? <img src={m.picture} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="mod-blank" />}
            <strong>{m.name}</strong>
            <small className="muted">
              by {m.author} · {m.endorsements.toLocaleString()} endorsements
            </small>
            <small>{m.summary}</small>
          </a>
        ))}
      </div>
    </section>
  );
}
