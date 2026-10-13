import { useEffect, useState, type FormEvent } from "react";
import { api, formatBytes, type Connectors, type DownloadRecord, type LiveDownload, type SearchResult } from "../api";

const eta = (s: number | null) => (s == null ? "" : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

export function Downloads() {
  const [query, setQuery] = useState("");
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
          {results.length === 0 ? (
            <p className="muted">Nothing found.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Indexer</th>
                  <th className="num">Size</th>
                  <th className="num">Seeds</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 100).map((r) => (
                  <tr key={r.guid}>
                    <td>
                      {r.infoUrl ? (
                        <a href={r.infoUrl} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                      ) : (
                        r.title
                      )}
                      <br />
                      <small className="muted">
                        {r.protocol}
                        {r.publishedAt ? ` · ${new Date(r.publishedAt).toLocaleDateString()}` : ""}
                      </small>
                    </td>
                    <td>{r.indexer}</td>
                    <td className="num">{formatBytes(r.sizeBytes)}</td>
                    <td className="num">{r.protocol === "torrent" ? (r.seeders ?? "?") : "—"}</td>
                    <td className="num">
                      <button disabled={busy} onClick={() => act(() => api.grab({ url: r.downloadUrl, title: r.title, protocol: r.protocol }), `Sent "${r.title}" to ${r.protocol === "usenet" ? "SABnzbd" : "qBittorrent"}`)}>
                        Get
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

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
                {d.live && d.status !== "imported" && (
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
  useEffect(() => {
    api.connectors().then((x) => {
      setC(x);
      setMapping(x.import.pathMappings.map((m) => `${m.from} => ${m.to}`).join("\n"));
    }, (e: Error) => onSaved(e.message));
  }, [onSaved]);
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
