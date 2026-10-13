import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { PLATFORMS } from "@lootden/shared";
import { api, formatBytes, type Connectors, type DownloadRecord, type FolderItem, type ImportProgress, type LiveDownload, type SearchResult } from "../api";
import { DownloadResults } from "../components/DownloadResults";

const eta = (s: number | null) => (s == null ? "" : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

export function Downloads() {
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [list, setList] = useState<{ downloads: DownloadRecord[]; other: LiveDownload[] }>({ downloads: [], other: [] });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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
        <button className="secondary" onClick={() => setShowSettings(!showSettings)}>
          {showSettings ? "Hide connections" : "Connections"}
        </button>
      </div>
      {msg && <p className="notice">{msg}</p>}
      {showSettings && <ConnectorSettings onSaved={(m) => setMsg(m)} />}

      <form className="panel inline" onSubmit={search}>
        <input type="search" placeholder="Search your Prowlarr indexers (usenet and torrent)" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" disabled={busy || !query.trim()}>
          Search
        </button>
      </form>

      {results && (
        <section className="panel">
          <h2>Results</h2>
          <DownloadResults results={results} onGrab={(r, platform) => act(() => api.grab({ url: r.downloadUrl, title: r.title, protocol: r.protocol, platform }), `Sent "${r.title}" to ${r.protocol === "usenet" ? "SABnzbd" : "qBittorrent"}`)} busy={busy} />
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

function ConnectorSettings({ onSaved }: { onSaved: (m: string) => void }) {
  const [c, setC] = useState<Connectors | null>(null);
  const [mapping, setMapping] = useState("");
  // Load once. The page around this form refreshes the queue every few seconds; reloading
  // here on each of those renders used to wipe whatever was being typed.
  const report = useRef(onSaved);
  report.current = onSaved;
  useEffect(() => {
    api.connectors().then((x) => {
      setC(x);
      setMapping(x.import.pathMappings.map((m) => `${m.from} => ${m.to}`).join("\n"));
    }, (e: Error) => report.current(e.message));
  }, []);
  if (!c) return null;
  const set = <K extends keyof Connectors>(k: K, patch: Partial<Connectors[K]>) => setC({ ...c, [k]: { ...c[k], ...patch } });
  const save = async () => {
    const pathMappings = mapping
      .split("\n")
      .map((l) => l.split("=>").map((x) => x.trim()))
      .filter((p) => p.length === 2 && p[0] && p[1])
      .map(([from, to]) => ({ from: from!, to: to! }));
    setC(await api.saveConnectors({ ...c, import: { ...c.import, pathMappings } }));
  };
  const test = async (name: string) => {
    try {
      await save();
      onSaved((await api.testConnector(name)).message + " is reachable");
    } catch (e) {
      onSaved((e as Error).message);
    }
  };
  return (
    <section className="panel connectors">
      <h2>Connections</h2>
      <h3>Prowlarr (search)</h3>
      <div className="inline">
        <input placeholder="http://tower:9696" value={c.prowlarr.url} onChange={(e) => set("prowlarr", { url: e.target.value })} />
        <input placeholder="API key" value={c.prowlarr.apiKey} onChange={(e) => set("prowlarr", { apiKey: e.target.value })} />
        <button onClick={() => test("prowlarr")}>Save and test</button>
      </div>
      <p className="muted small">Add indexers (and FlareSolverr as an indexer proxy for sites behind Cloudflare) in Prowlarr itself; searches here use PC game categories.</p>
      <h3>qBittorrent (torrents)</h3>
      <div className="inline">
        <input placeholder="http://tower:8080" value={c.qbittorrent.url} onChange={(e) => set("qbittorrent", { url: e.target.value })} />
        <input placeholder="Username" value={c.qbittorrent.username} onChange={(e) => set("qbittorrent", { username: e.target.value })} />
        <input type="password" placeholder="Password" value={c.qbittorrent.password} onChange={(e) => set("qbittorrent", { password: e.target.value })} />
        <input placeholder="Category" value={c.qbittorrent.category} onChange={(e) => set("qbittorrent", { category: e.target.value })} style={{ width: 120 }} />
        <button onClick={() => test("qbittorrent")}>Save and test</button>
      </div>
      <h3>SABnzbd (usenet)</h3>
      <div className="inline">
        <input placeholder="http://tower:8085" value={c.sabnzbd.url} onChange={(e) => set("sabnzbd", { url: e.target.value })} />
        <input placeholder="API key" value={c.sabnzbd.apiKey} onChange={(e) => set("sabnzbd", { apiKey: e.target.value })} />
        <input placeholder="Category" value={c.sabnzbd.category} onChange={(e) => set("sabnzbd", { category: e.target.value })} style={{ width: 120 }} />
        <button onClick={() => test("sabnzbd")}>Save and test</button>
      </div>
      <h3>Import into the library</h3>
      <div className="inline">
        <label>
          When a download finishes
          <select value={c.import.mode} onChange={(e) => set("import", { mode: e.target.value as Connectors["import"]["mode"] })}>
            <option value="copy">Copy it (keeps torrents seeding)</option>
            <option value="move">Move it (frees the space)</option>
            <option value="off">Leave it where it is</option>
          </select>
        </label>
      </div>
      <div className="tidy-options">
        <label className="check">
          <input type="checkbox" checked={c.import.tidy.stripJunk} onChange={(e) => set("import", { tidy: { ...c.import.tidy, stripJunk: e.target.checked } })} />
          Remove junk (site links, .nfo files, read-me and "install tutorial" files)
        </label>
        <label className="check">
          <input type="checkbox" checked={c.import.tidy.extract} onChange={(e) => set("import", { tidy: { ...c.import.tidy, extract: e.target.checked } })} />
          Unpack archives inside the download, including archives inside archives
        </label>
        <label>
          Store the game as
          <select value={c.import.tidy.repack} onChange={(e) => set("import", { tidy: { ...c.import.tidy, repack: e.target.value as "zip" | "folder" } })}>
            <option value="zip">One zip named "Title v1.2.zip" (smaller, fewer files)</option>
            <option value="folder">A folder named "Title v1.2"</option>
          </select>
        </label>
        <p className="muted small">Disc images and installers are kept as folders so you can set them up once from the app.</p>
      </div>
      <h3>Downloads folder</h3>
      <div className="inline">
        <input placeholder="/downloads/complete (as this container sees it)" value={c.import.folder} onChange={(e) => set("import", { folder: e.target.value })} style={{ flex: 1 }} />
        <label className="check">
          <input type="checkbox" checked={c.import.autoImportFolder} onChange={(e) => set("import", { autoImportFolder: e.target.checked })} />
          Import new games from it automatically
        </label>
      </div>
      <p className="muted small">Games already sitting there (from any client, or copied in by hand) are listed on this page to import with the same clean-up. Mount the folder into the container first.</p>
      <h3>itch.io</h3>
      <div className="inline">
        <input type="password" placeholder="itch.io API key" value={c.itch.apiKey} onChange={(e) => set("itch", { apiKey: e.target.value })} style={{ flex: 1 }} />
        <a className="button" href="https://itch.io/user/settings/api-keys" target="_blank" rel="noreferrer">
          Get a key
        </a>
      </div>
      <p className="muted small">Lets admins add free itch.io games from Discover, Free games straight into the library.</p>
      <label>
        Path mappings, one per line: <code>client path =&gt; path in this container</code>
        <textarea rows={3} value={mapping} onChange={(e) => setMapping(e.target.value)} placeholder="/data/torrents => /downloads" />
      </label>
      <button
        className="primary"
        onClick={async () => {
          try {
            await save();
            onSaved("Connections saved");
          } catch (e) {
            onSaved((e as Error).message);
          }
        }}
      >
        Save
      </button>
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
