import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type FreeGame } from "../api";

const STORES: Array<{ id: FreeGame["store"]; name: string; note: string }> = [
  { id: "epic", name: "Epic Games Store", note: "A new free game every week. Claim it on Epic while it's free and it's yours to keep." },
  { id: "steam", name: "Steam", note: "Paid games that are 100% off for a short time." },
  { id: "gog", name: "GOG", note: "Giveaways and 100% off games. GOG games are DRM-free installers." },
  { id: "prime", name: "Prime Gaming", note: "Free games every month with Amazon Prime." },
  { id: "itch", name: "itch.io", note: "Top-rated free games for Windows and Linux." },
];

function when(g: FreeGame): string | null {
  if (g.upcoming && g.startsAt) return `Free from ${new Date(g.startsAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
  if (g.endsAt) return `Free until ${new Date(g.endsAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
  return g.kind === "free" ? "Always free" : null;
}

/** Free games to grab from the stores themselves. */
export function FreeGames({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.freeGames>> | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({});

  useEffect(() => {
    api.freeGames().then(setData, (e: Error) => setError(e.message));
  }, []);

  const add = async (g: FreeGame) => {
    setAdding(g.url);
    try {
      await api.addItchGame(g.url);
      setAdded((a) => ({ ...a, [g.url]: "Added to the library" }));
    } catch (e) {
      setAdded((a) => ({ ...a, [g.url]: (e as Error).message }));
    } finally {
      setAdding(null);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Checking the stores…</p>;
  return (
    <div className="free-games">
      {STORES.map((s) => {
        const games = data.games.filter((g) => g.store === s.id);
        const err = data.errors.find((e) => e.store === s.id);
        if (!games.length && !err) return null;
        return (
          <section key={s.id} className="row">
            <div className="row-head">
              <h2>{s.name}</h2>
              <span className="muted small">{s.note}</span>
            </div>
            {err && <p className="error small">Couldn't load {s.name} right now: {err.message}</p>}
            {s.id === "itch" && isAdmin && !data.itchConnected && (
              <p className="muted small">
                Add your itch.io API key in <Link to="/settings/services">Settings</Link> to put these straight into the library.
              </p>
            )}
            <div className="free-grid">
              {games.map((g) => (
                <div key={g.url} className={`free-card${g.upcoming ? " upcoming" : ""}`}>
                  <a href={g.url} target="_blank" rel="noreferrer" className="free-art">
                    {g.image ? <img src={g.image} alt="" loading="lazy" /> : <span className="free-art-empty">{s.name}</span>}
                  </a>
                  <div className="free-body">
                    <strong>{g.title}</strong>
                    <small className="muted">{when(g) ?? " "}</small>
                    <div className="inline wrap">
                      <a className={`button small${g.upcoming ? "" : " primary"}`} href={g.url} target="_blank" rel="noreferrer">
                        {g.upcoming ? "View" : s.id === "itch" ? "Download on itch.io" : s.id === "prime" ? "Open Prime Gaming" : `Claim on ${s.name.replace(" Games Store", "")}`}
                      </a>
                      {g.store === "itch" && isAdmin && data.itchConnected && (
                        <button className="small" disabled={!!adding || g.url in added} onClick={() => void add(g)}>
                          {adding === g.url ? "Adding…" : "Add to library"}
                        </button>
                      )}
                    </div>
                    {added[g.url] && <small className={added[g.url] === "Added to the library" ? "muted" : "error"}>{added[g.url]}</small>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <p className="muted small">Only official store offers are listed. Claiming happens on each store with your own account.</p>
    </div>
  );
}
