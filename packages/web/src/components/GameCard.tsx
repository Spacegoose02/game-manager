import { Link } from "react-router-dom";
import type { GameSummary } from "@game-manager/shared";
import { Badges } from "./Badges";
import { Cover } from "./Cover";

export function GameCard({ game }: { game: GameSummary }) {
  return (
    <Link to={`/games/${game.id}`} className="card" aria-label={game.title}>
      <Cover game={game} />
      <div className="card-body">
        <div className="card-title">{game.title}</div>
        <div className="card-meta">
          {game.releaseYear ?? ""}
          {game.genres[0] ? ` · ${game.genres[0]}` : ""}
        </div>
        <Badges game={game} compact />
      </div>
    </Link>
  );
}

export function GameGrid({ games }: { games: GameSummary[] }) {
  return (
    <div className="grid">
      {games.map((g) => (
        <GameCard key={g.id} game={g} />
      ))}
    </div>
  );
}

/** Horizontally scrolling row with snap points; swipe on touch, arrows or d-pad elsewhere. */
export function GameRow({ title, games }: { title: string; games: GameSummary[] }) {
  return (
    <section className="row">
      <h2>{title}</h2>
      <div className="row-track">
        {games.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
      </div>
    </section>
  );
}
