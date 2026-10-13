import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { GameSummary } from "@lootden/shared";
import { api } from "../api";
import { GameGrid } from "../components/GameCard";

const SORTS = [
  ["title", "Title"],
  ["added", "Recently added"],
  ["release", "Release year"],
  ["rating", "Rating"],
  ["size", "Size"],
] as const;

export function Library() {
  const [params, setParams] = useSearchParams();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [genres, setGenres] = useState<Array<{ name: string; count: number }>>([]);
  const [error, setError] = useState("");
  const search = params.get("search") ?? "";
  const genre = params.get("genre") ?? "";
  const controller = params.get("controller") ?? "";
  const kidSafe = params.get("kidSafe") === "true";
  const sort = params.get("sort") ?? "title";

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    api.genres().then(setGenres, () => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const desc = sort === "added" || sort === "rating" || sort === "release" || sort === "size";
      api
        .games({ search, genre, controller, kidSafe, sort, order: desc ? "desc" : "asc" })
        .then((g) => {
          setGames(g);
          setError("");
        }, (e: Error) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [search, genre, controller, kidSafe, sort]);

  return (
    <>
      <div className="filters panel">
        <input type="search" placeholder="Search games" value={search} onChange={(e) => set("search", e.target.value)} aria-label="Search" />
        <select value={genre} onChange={(e) => set("genre", e.target.value)} aria-label="Genre">
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name} ({g.count})
            </option>
          ))}
        </select>
        <select value={controller} onChange={(e) => set("controller", e.target.value)} aria-label="Controller support">
          <option value="">Any input</option>
          <option value="full">Full controller support</option>
          <option value="partial">Some controller support</option>
        </select>
        <select value={sort} onChange={(e) => set("sort", e.target.value)} aria-label="Sort">
          {SORTS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={kidSafe} onChange={(e) => set("kidSafe", e.target.checked ? "true" : "")} />
          Kid-safe only
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {games === null ? <p className="muted">Loading…</p> : games.length === 0 ? <p className="muted">No games match.</p> : (
        <>
          <p className="muted count">{games.length} games</p>
          <GameGrid games={games} />
        </>
      )}
    </>
  );
}
