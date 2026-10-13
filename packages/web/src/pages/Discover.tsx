import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { GameListing } from "@lootden/shared";
import { api, type ListingResult, type SearchResult } from "../api";
import { useAuth } from "../auth";
import { DownloadResults } from "../components/DownloadResults";
import { ListingCard, ListingRow } from "../components/Listing";

/** Find games that aren't in the library yet; admins can send them straight to the downloaders. */
export function Discover() {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [query, setQuery] = useState(q);
  const [results, setResults] = useState<GameListing[] | null>(null);
  const [lists, setLists] = useState<{ trending: ListingResult; upcoming: ListingResult } | null>(null);
  const [error, setError] = useState("");
  const [finding, setFinding] = useState<GameListing | null>(null);

  useEffect(() => {
    api.discover().then(setLists, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    setResults(null);
    if (!q) return;
    api.discoverSearch(q).then(setResults, (e: Error) => setError(e.message));
  }, [q]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setParams(query.trim() ? { q: query.trim() } : {});
  };

  return (
    <div className="discover">
      <h1>Discover</h1>
      <form className="panel inline search-hero" onSubmit={submit}>
        <input type="search" placeholder="Search every game, not just your library" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} autoFocus />
        <button className="primary" disabled={!query.trim()}>
          Search
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      {q && (
        <section className="row">
          <h2>Results for “{q}”</h2>
          {!results ? (
            <p className="muted">Searching…</p>
          ) : results.length === 0 ? (
            <p className="muted">Nothing found.</p>
          ) : (
            <div className="listing-grid">
              {results.map((r) => (
                <ListingCard
                  key={`${r.provider}:${r.providerId}`}
                  item={r}
                  action={
                    r.libraryId ? (
                      <Link className="button small" to={`/games/${r.libraryId}`}>
                        Open
                      </Link>
                    ) : isAdmin ? (
                      <button className="small" onClick={() => setFinding(r)}>
                        Find downloads
                      </button>
                    ) : null
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {finding && <FindDownloads game={finding} onClose={() => setFinding(null)} />}

      {lists && (
        <>
          <ListingRow title="New and popular" items={lists.trending.items} />
          <ListingRow title="Coming soon" items={lists.upcoming.items} more={{ to: "/calendar", label: "Full calendar" }} />
          <p className="muted small">
            Lists from {lists.trending.source === lists.upcoming.source ? lists.trending.source : `${lists.trending.source} and ${lists.upcoming.source}`}.
            {!isAdmin && " Ask an admin to grab anything you'd like added."}
          </p>
        </>
      )}
    </div>
  );
}

function FindDownloads({ game, onClose }: { game: GameListing; onClose: () => void }) {
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
          <button onClick={onClose}>Close</button>
        </span>
      </div>
      {msg && <p className="notice">{msg}</p>}
      {!results && !msg && <p className="muted">Searching your indexers…</p>}
      {results && (
        <DownloadResults
          results={results}
          busy={busy}
          onGrab={async (r) => {
            setBusy(true);
            try {
              await api.grab({ url: r.downloadUrl, title: r.title, protocol: r.protocol });
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
