import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PLATFORMS } from "@lootden/shared";
import { api, formatBytes, type DownloadRecord, type ScanRecord, type FolderItem, type ImportProgress, type LiveDownload, type SearchResult } from "../api";
import { DownloadResults } from "../components/DownloadResults";

const eta = (s: number | null) => (s == null ? "" : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

export function Downloads() {
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [list, setList] = useState<{ downloads: DownloadRecord[]; other: LiveDownload[] }>({ downloads: [], other: [] });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.downloads().then(setList, (e: Error) => setMsg(e.message));
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) setMsg(done);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Arriving from Discover with ?q= runs the search straight away.
  useEffect(() => {
    const q = params.get("q");
    if (q) void act(async () => setResults(await api.searchDownloads(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => setResults(await api.searchDownloads(query)));
  };

  return (
    <div className="downloads">
      <div className="inline" style={{ justifyContent: "space-between" }}>
        <h1>Downloads</h1>
        <Link className="button secondary" to="/settings/downloads">
          Download settings
        </Link>
      </div>
      {msg && <p className="notice">{msg}</p>}
      <HeldForReview onMessage={setMsg} />

      <form className="panel inline" onSubmit={search}>
        <input type="search" placeholder="Search your Prowlarr indexers (usenet and torrent)" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" disabled={busy || !query.trim()}>
          Search
        </button>
      </form>

      {results && (
        <section className="panel">
          <h2>Results</h2>
          <DownloadResults results={results} onGrab={(r, platform) => act(() => api.grab({ url: r.downloadUrl, title: r.title, protocol: r.protocol, platform }), `Sent "${r.title}" to ${r.protocol === "usenet" ? "SABnzbd" : "the torrent client"}`)} busy={busy} />
        </section>
      )}

      <DownloadsFolder onMessage={setMsg} />

      <section className="panel">
        <h2>Queue</h2>
        {list.downloads.length === 0 && <p className="muted">Nothing sent yet. Finished downloads are copied or moved into the games folder and show up in the library.</p>}
        <ul className="list">
          {list.downloads.map((d) => (
            <li key={d.id} className="download">
              <div style={{ flex: 1, minWidth: 240 }}>
                <strong>{d.name}</strong>
                <br />
                <small className="muted">
                  {d.client} · {d.status === "imported" ? `imported to ${d.importedPath}` : d.live ? `${d.live.state}${d.live.downloadSpeed ? ` · ${formatBytes(d.live.downloadSpeed)}/s` : ""}${d.live.etaSeconds ? ` · ${eta(d.live.etaSeconds)} left` : ""}` : d.status}
                </small>
                {d.error && <small className="error"> · {d.error}</small>}
                {d.progress ? (
                  <ImportMeter progress={d.progress} />
                ) : d.live && d.status !== "imported" && (
                  <div className="meter slim">
                    <div style={{ width: `${d.live.progress * 100}%` }} />
                  </div>
                )}
              </div>
              <span className="inline">
                {d.live && d.live.state === "paused" && <button onClick={() => act(() => api.controlDownload(d.id, "resume"))}>Resume</button>}
                {d.live && d.live.state === "downloading" && <button onClick={() => act(() => api.controlDownload(d.id, "pause"))}>Pause</button>}
                <button className="ghost" onClick={() => act(() => api.controlDownload(d.id, "remove", d.status !== "imported" && confirm("Also delete the downloaded files?")))}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        {list.other.length > 0 && (
          <>
            <h3>Also in the game category</h3>
            <ul className="list">
              {list.other.map((o) => (
                <li key={o.client + o.id}>
                  <span>
                    {o.name} <small className="muted">({o.client}, {Math.round(o.progress * 100)}%, {o.state})</small>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/** Imports the virus scan flagged, waiting for an admin to release or delete them. */
function HeldForReview({ onMessage }: { onMessage: (m: string) => void }) {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.scans().then(setScans, () => {});
  }, []);
  const held = scans.filter((s) => s.status === "flagged" && s.heldPath);
  if (!held.length) return null;
  const decide = async (s: ScanRecord, action: "release" | "delete") => {
    if (action === "delete" && !confirm(`Delete ${s.name} for good?`)) return;
    setBusy(true);
    try {
      setScans(await api.decideScan(s.id, action));
      onMessage(action === "release" ? `${s.name} is in the library` : `Deleted ${s.name}`);
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel held" id="held">
      <h2>Held for review</h2>
      <p className="muted small">The virus scan flagged these, so they were kept out of the library.</p>
      <ul className="list">
        {held.map((s) => (
          <li key={s.id} className="download">
            <div style={{ flex: 1, minWidth: 240 }}>
              <strong>{s.name}</strong>
              <br />
              <small className="muted">Scanned {new Date(s.scannedAt).toLocaleString()}</small>
              <ul className="findings">
                {s.findings.slice(0, 6).map((f, i) => (
                  <li key={i}>
                    <small className="error">{f.threat}</small> <small className="muted">{f.file}</small>
                  </li>
                ))}
              </ul>
            </div>
            <span className="inline">
              <button disabled={busy} onClick={() => void decide(s, "release")}>
                Add to library anyway
              </button>
              <button className="ghost" disabled={busy} onClick={() => void decide(s, "delete")}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Games already in the downloads folder: import them with the usual clean-up, or leave them be. */
function DownloadsFolder({ onMessage }: { onMessage: (m: string) => void }) {
  const [data, setData] = useState<{ folder: string; items: FolderItem[] } | null>(null);
  const [platforms, setPlatforms] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const load = () => api.downloadsFolder().then(setData, (e: Error) => setData({ folder: "", items: [] }) ?? onMessage(e.message));
  useEffect(() => {
    void load();
  }, []);
  const active = !!busy || !!data?.items.some((i) => i.status === "importing");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void api.downloadsFolder().then(setData, () => {}), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!data?.folder) return null;
  // ROM files say which system they're for when only one system uses the extension.
  const guess = (name: string) => {
    const ext = name.match(/\.(\w+)$/)?.[1]?.toLowerCase();
    const hits = ext ? PLATFORMS.filter((p) => p.id !== "pc" && p.extensions.includes(ext)) : [];
    return hits.length === 1 ? hits[0]!.id : "pc";
  };
  const items = data.items.filter((i) => showDone || i.status === "new" || i.status === "failed" || i.status === "importing");
  const run = async (name: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(name);
    try {
      await fn();
      onMessage(done);
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(null);
      await load();
    }
  };
  return (
    <section className="panel">
      <div className="inline" style={{ justifyContent: "space-between" }}>
        <h2>In the downloads folder</h2>
        <label className="check small">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show imported and skipped
        </label>
      </div>
      <p className="muted small">
        <code>{data.folder}</code>. Import unpacks archives, removes junk and stores the game in the library (or a console's folder).
      </p>
      {items.length === 0 ? (
        <p className="muted">Nothing new.</p>
      ) : (
        <ul className="list">
          {items.map((i) => (
            <li key={i.name} className="download">
              <div style={{ flex: 1, minWidth: 240 }}>
                <strong>{i.name}</strong>
                <br />
                <small className="muted">
                  {formatBytes(i.sizeBytes)} · {new Date(i.modifiedAt).toLocaleString()}
                  {i.settling ? " · still being written" : ""}
                  {i.status === "imported" ? ` · imported to ${i.target}` : i.status !== "new" ? ` · ${i.status}` : ""}
                </small>
                {i.error && <small className="error"> · {i.error}</small>}
                {i.progress && <ImportMeter progress={i.progress} />}
              </div>
              {i.status !== "imported" && (
                <span className="inline">
                  <select value={platforms[i.name] ?? guess(i.name)} onChange={(e) => setPlatforms({ ...platforms, [i.name]: e.target.value })} aria-label="Send to">
                    {PLATFORMS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id === "pc" ? "PC games" : `Emulation: ${p.short}`}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary"
                    disabled={!!busy || i.settling}
                    onClick={() => {
                      const p = platforms[i.name] ?? guess(i.name);
                      void run(i.name, () => api.importFromFolder(i.name, p === "pc" ? null : p), `Imported ${i.name}`);
                    }}
                  >
                    {busy === i.name ? "Importing…" : "Import"}
                  </button>
                  {i.status !== "skipped" && (
                    <button className="ghost" disabled={!!busy} onClick={() => void run(i.name, () => api.skipFolderItem(i.name), `Skipping ${i.name}`)}>
                      Skip
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STAGES: Record<ImportProgress["stage"], string> = { copying: "Copying", unpacking: "Unpacking", cleaning: "Cleaning up", zipping: "Zipping" };

/** "Unpacking 42%" with a bar; steps that can't measure themselves show a moving bar. */
function ImportMeter({ progress }: { progress: ImportProgress }) {
  return (
    <div className="import-meter">
      <small>
        {STAGES[progress.stage]}
        {progress.percent != null ? ` ${progress.percent}%` : "…"}
      </small>
      <div className={`meter slim${progress.percent == null ? " busy" : ""}`}>
        <div style={{ width: `${progress.percent ?? 100}%` }} />
      </div>
    </div>
  );
}
