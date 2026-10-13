import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type WishItem, type WishlistState } from "../api";
import { useAuth } from "../auth";
import { FindDownloads } from "../components/FindDownloads";

type Filter = "all" | "missing" | "owned" | "upcoming";

const when = (w: WishItem) => {
  if (w.releaseDate) {
    const d = new Date(`${w.releaseDate}T12:00:00`);
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return d.getTime() > Date.now() ? `Out ${label}` : `Released ${label}`;
  }
  return w.dateText ?? null;
};

/** Games the household wants: the Steam wishlist, list feeds and anything added by hand, one entry per game. */
export function Wishlist() {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const [data, setData] = useState<WishlistState | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [title, setTitle] = useState("");
  const [finding, setFinding] = useState<WishItem | null>(null);
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    api.wishlist().then(setData, (e: Error) => setMsg({ text: e.message, error: true }));
  }, []);

  const run = async (fn: () => Promise<WishlistState>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      setData(await fn());
      if (done) setMsg({ text: done });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const items = useMemo(() => {
    const all = data?.items ?? [];
    const today = new Date().toISOString().slice(0, 10);
    if (filter === "missing") return all.filter((i) => !i.libraryId);
    if (filter === "owned") return all.filter((i) => i.libraryId);
    if (filter === "upcoming") return all.filter((i) => (i.releaseDate ? i.releaseDate > today : !!i.dateText)).sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"));
    return all;
  }, [data, filter]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    void run(() => api.addWish(title.trim()), `Added ${title.trim()}`).then(() => setTitle(""));
  };

  const noSources = !!data && !data.steam?.steamId && data.feeds.length === 0;

  return (
    <div className="wishlist">
      <div className="inline" style={{ justifyContent: "space-between" }}>
        <h1>Wishlist</h1>
        <span className="inline">
          {isAdmin && (
            <button onClick={() => setShowSources(!showSources)} aria-expanded={showSources}>
              Sources
            </button>
          )}
          <button className="primary" disabled={busy || noSources} onClick={() => void run(() => api.syncWishlist(), "Synced")}>
            {busy ? "Working…" : "Sync now"}
          </button>
        </span>
      </div>

      {data && (showSources || (isAdmin && noSources)) && isAdmin && <Sources data={data} busy={busy} run={run} />}
      {data && !isAdmin && noSources && <p className="muted">An admin can link a Steam wishlist or add list feeds here. You can add games by hand below.</p>}

      <form className="panel inline" onSubmit={add}>
        <input placeholder="Add a game by name" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
        <button disabled={busy || !title.trim()}>Add</button>
      </form>
      {msg && <p className={msg.error ? "error" : "notice"}>{msg.text}</p>}

      {data && (
        <div className="segmented" role="tablist" aria-label="Show">
          {(
            [
              ["all", `All ${data.items.length}`],
              ["missing", "Not in library"],
              ["owned", "In library"],
              ["upcoming", "Coming out"],
            ] as const
          ).map(([f, label]) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {finding && <FindDownloads game={{ name: finding.title }} onClose={() => setFinding(null)} />}

      {!data && !msg && <p className="muted">Loading…</p>}
      {data && items.length === 0 && <p className="muted">{data.items.length ? "Nothing here with this filter." : "Your wishlist is empty."}</p>}
      <div className="wish-grid">
        {items.map((w) => (
          <div key={w.id} className="wish-card">
            <Link to={w.libraryId ? `/games/${w.libraryId}` : w.steamAppId ? `/discover/steam/${w.steamAppId}` : `/discover?q=${encodeURIComponent(w.title)}`} className="wish-art">
              {w.image ? <img src={w.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="wish-blank">{w.title.slice(0, 1)}</span>}
              {w.libraryId && <span className="tag in-library">In library</span>}
            </Link>
            <div className="wish-body">
              <strong>{w.title}</strong>
              {when(w) && <small className="muted">{when(w)}</small>}
              <span className="inline wrap">
                {w.sources.map((s) => (
                  <span key={s.kind === "feed" ? `feed${s.id}` : s.kind} className={`badge small source-${s.kind}`}>
                    {s.name}
                  </span>
                ))}
              </span>
              <span className="inline wrap wish-actions">
                {w.url && (
                  <a className="button small" href={w.url} target="_blank" rel="noreferrer">
                    {w.steamAppId ? "Steam page" : "Open link"}
                  </a>
                )}
                {isAdmin && !w.libraryId && (
                  <button className="small" onClick={() => setFinding(w)}>
                    Find downloads
                  </button>
                )}
                <button className="ghost small" disabled={busy} title="Removed games stay off when syncing" onClick={() => void run(() => api.removeWish(w.id))}>
                  Remove
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Admin: the Steam profile to mirror and the list feeds to pull from. */
function Sources({ data, busy, run }: { data: WishlistState; busy: boolean; run: (fn: () => Promise<WishlistState>, done?: string) => Promise<void> }) {
  const [profile, setProfile] = useState(data.steam?.profile ?? "");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedName, setFeedName] = useState("");
  const steam = data.steam;
  return (
    <section className="panel wish-sources">
      <h2>Steam wishlist</h2>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api.linkSteamWishlist(profile), profile.trim() ? "Linked and synced" : "Unlinked");
        }}
      >
        <input placeholder="Steam profile link, custom URL name or Steam ID" value={profile} onChange={(e) => setProfile(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" disabled={busy}>
          {steam?.steamId && !profile.trim() ? "Unlink" : "Link"}
        </button>
      </form>
      <p className="muted small">
        {steam?.steamId
          ? `${steam.count} games${steam.syncedAt ? `, synced ${new Date(steam.syncedAt).toLocaleString()}` : ""}. Checked every six hours.`
          : "The wishlist must be public: in Steam, Profile, Edit Profile, Privacy Settings, set Game details to Public."}
      </p>
      {steam?.error && <p className="error small">{steam.error}</p>}

      <h2>List feeds</h2>
      <p className="muted small">Any RSS or Atom feed of games. Each item becomes a wishlist entry; a game already on the list from Steam or another feed isn't added twice.</p>
      {data.feeds.length > 0 && (
        <ul className="list">
          {data.feeds.map((f) => (
            <li key={f.id} className="inline" style={{ justifyContent: "space-between" }}>
              <span>
                <strong>{f.name}</strong>
                <br />
                <small className="muted">
                  {f.url} · {f.itemCount} items{f.checkedAt ? ` · checked ${new Date(f.checkedAt).toLocaleString()}` : ""}
                </small>
                {f.error && <small className="error"> · {f.error}</small>}
              </span>
              <button className="ghost small" disabled={busy} onClick={() => void run(() => api.removeWishFeed(f.id), `Removed ${f.name} and the games only it added`)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api.addWishFeed(feedUrl.trim(), feedName.trim() || undefined), "Feed added").then(() => {
            setFeedUrl("");
            setFeedName("");
          });
        }}
      >
        <input type="url" placeholder="https://example.com/list/rss" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} style={{ flex: 2 }} />
        <input placeholder="Name (optional)" value={feedName} onChange={(e) => setFeedName(e.target.value)} style={{ flex: 1 }} />
        <button disabled={busy || !feedUrl.trim()}>Add feed</button>
      </form>
    </section>
  );
}
