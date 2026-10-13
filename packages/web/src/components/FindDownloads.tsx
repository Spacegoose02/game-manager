import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type SearchResult } from "../api";
import { DownloadResults } from "./DownloadResults";

/** Admin: Prowlarr results for one game, with Get buttons, right where the game is shown. */
export function FindDownloads({ game, onClose }: { game: { name: string }; onClose?: () => void }) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setResults(null);
    setMsg("");
    api.searchDownloads(game.name).then(setResults, (e: Error) => setMsg(e.message));
  }, [game]);

  return (
    <section className="panel find-downloads">
      <div className="inline" style={{ justifyContent: "space-between" }}>
        <h2>Downloads for {game.name}</h2>
        <span className="inline">
          <Link className="button" to={`/downloads?q=${encodeURIComponent(game.name)}`}>
            Open in Downloads
          </Link>
          {onClose && <button onClick={onClose}>Close</button>}
        </span>
      </div>
      {msg && <p className="notice">{msg}</p>}
      {!results && !msg && <p className="muted">Searching your indexers…</p>}
      {results && (
        <DownloadResults
          results={results}
          busy={busy}
          onGrab={async (r, platform) => {
            setBusy(true);
            try {
              await api.grab({ url: r.downloadUrl, title: r.title, protocol: r.protocol, platform });
              setMsg(`Sent "${r.title}" to ${r.protocol === "usenet" ? "SABnzbd" : "qBittorrent"}. It shows up in the library when it finishes.`);
            } catch (e) {
              setMsg((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}
