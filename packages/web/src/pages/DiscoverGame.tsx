import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { GameInfo } from "@lootden/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { FindDownloads } from "../components/FindDownloads";
import { listingDate } from "../components/Listing";

const SOURCES: Record<string, string> = { igdb: "IGDB", rawg: "RAWG", steam: "Steam" };

/** A game that isn't in the library yet, shown inside LootDen from IGDB, RAWG or Steam. */
export function DiscoverGame() {
  const { provider = "", id = "" } = useParams();
  const { me } = useAuth();
  const [game, setGame] = useState<GameInfo | null>(null);
  const [error, setError] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const releases = useRef<HTMLElement>(null);
  const canSearch = me?.role === "admin" && !!game && !game.libraryId;

  useEffect(() => {
    setGame(null);
    setError("");
    api.discoverGame(provider, id).then(setGame, (e: Error) => setError(e.message));
  }, [provider, id]);

  if (error) return <p className="error">{error}</p>;
  if (!game) return <p className="muted">Loading…</p>;
  const bg = game.imageUrl ?? game.screenshots[0] ?? game.coverUrl;
  const date = listingDate(game);

  return (
    <article className="detail discover-game">
      {bg && <div className="detail-bg wide" style={{ backgroundImage: `url(${bg})` }} />}
      <div className="detail-head">
        {game.coverUrl ? (
          <img className="cover cover-hero cover-natural" src={game.coverUrl} alt="" />
        ) : (
          <div className="cover cover-hero cover-placeholder">{game.name}</div>
        )}
        <div className="detail-info">
          <h1>{game.name}</h1>
          <p className="muted">{[date, game.genres.join(", ")].filter(Boolean).join(" · ")}</p>
          <div className="inline wrap">
            {game.rating != null && <span className="badge">★ {game.rating}/100</span>}
            {game.platforms.map((p) => (
              <span key={p} className="badge">
                {p}
              </span>
            ))}
          </div>
          {game.developers.length > 0 && <p className="muted small">By {game.developers.join(", ")}</p>}
          {game.ageRatings.length > 0 && (
            <p className="muted small">Age ratings: {game.ageRatings.map((r) => `${r.organization} ${r.rating}`).join(", ")}</p>
          )}
          {game.summary && <p className="summary">{game.summary}</p>}
          <div className="inline wrap">
            {canSearch && (
              <button className="primary" onClick={() => releases.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                Search for releases
              </button>
            )}
            {game.libraryId && (
              <Link className="button primary" to={`/games/${game.libraryId}`}>
                In your library
              </Link>
            )}
            {game.url && (
              <a className="button" href={game.url} target="_blank" rel="noreferrer">
                View on {SOURCES[game.provider] ?? "source"}
              </a>
            )}
          </div>
        </div>
      </div>

      {game.trailer && (
        <section className="row">
          <h2>Trailer</h2>
          <div className="video-frame trailer">
            {"youtubeId" in game.trailer ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${game.trailer.youtubeId}?rel=0`}
                title={`${game.name} trailer`}
                allow="encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            ) : (
              <video src={game.trailer.url} poster={game.trailer.poster ?? undefined} controls preload="none" />
            )}
          </div>
        </section>
      )}

      {game.screenshots.length > 0 && (
        <section className="row">
          <h2>Screenshots</h2>
          <div className="screenshots">
            {game.screenshots.map((s) => (
              <button key={s} className="screenshot" onClick={() => setShot(s)}>
                <img src={s} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </section>
      )}

      {canSearch && (
        <section className="row" ref={releases}>
          <FindDownloads game={game} />
        </section>
      )}

      {shot && (
        <div className="lightbox" onClick={() => setShot(null)}>
          <img className="lightbox-image" src={shot} alt="" />
        </div>
      )}
    </article>
  );
}
