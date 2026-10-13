import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type HomeData } from "../api";
import { Badges } from "../components/Badges";
import { Cover } from "../components/Cover";
import { GameRow } from "../components/GameCard";

export function Home() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    api.home().then(setData, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!data?.featured.length) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % data.featured.length), 8000);
    return () => clearInterval(t);
  }, [data]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!data.sections.length) {
    return (
      <div className="empty">
        <h1>Your library is empty</h1>
        <p className="muted">Put games in the server's games folder (one folder per game, or one archive per game). They show up here automatically.</p>
      </div>
    );
  }
  const hero = data.featured[slide];
  return (
    <>
      {hero && (
        <section className="hero">
          <div className="hero-bg" style={hero.coverUrl ? { backgroundImage: `url(${hero.coverUrl})` } : undefined} />
          <Link to={`/games/${hero.id}`} className="hero-content">
            <Cover game={hero} size="hero" />
            <div>
              <p className="eyebrow">Featured</p>
              <h1>{hero.title}</h1>
              <p className="muted">
                {[hero.releaseYear, hero.genres.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}
              </p>
              <Badges game={hero} />
            </div>
          </Link>
          <div className="hero-dots">
            {data.featured.map((g, i) => (
              <button key={g.id} className={i === slide ? "dot active" : "dot"} aria-label={`Show ${g.title}`} onClick={() => setSlide(i)} />
            ))}
          </div>
        </section>
      )}
      {data.sections.map((s) => (
        <GameRow key={s.id} title={s.title} games={s.games} />
      ))}
    </>
  );
}
