import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { GameDetail as Game } from "@lootden/shared";
import { api, formatBytes, type Candidate } from "../api";
import { useAuth } from "../auth";
import { Badges } from "../components/Badges";
import { Cover } from "../components/Cover";
import { ArtworkEditor } from "../components/ArtworkEditor";
import { DesktopInstall } from "../components/DesktopInstall";
import { SavesPanel } from "../components/SavesPanel";
import { PreparePanel } from "../components/PreparePanel";
import { desktop } from "../desktop";

export function GameDetail() {
  const { id = "" } = useParams();
  const { me } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [params] = useSearchParams();

  useEffect(() => {
    setGame(null);
    api.game(id).then(setGame, (e: Error) => setError(e.message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!game) return <p className="muted">Loading…</p>;
  const m = game.metadata;
  const command = `gm install ${game.id}`;

  return (
    <article className="detail">
      <div className={`detail-bg${game.backgroundUrl ? " wide" : ""}`} style={game.backgroundUrl || game.coverUrl ? { backgroundImage: `url(${game.backgroundUrl ?? game.coverUrl})` } : undefined} />
      <div className="detail-head">
        <Cover game={game} size="hero" />
        <div className="detail-info">
          <h1>{game.title}</h1>
          <p className="muted">
            {[game.releaseYear, game.genres.join(", "), formatBytes(game.sizeBytes)].filter(Boolean).join(" · ")}
          </p>
          <Badges game={game} />
          {m?.ageRatings.length ? (
            <p className="muted small">Age ratings: {m.ageRatings.map((r) => `${r.organization} ${r.rating}`).join(", ")}</p>
          ) : null}
          {m?.summary && <p className="summary">{m.summary}</p>}

          {desktop ? (
            <DesktopInstall game={game} autoFocus={params.get("install") === "1"} />
          ) : (
          <div className="install panel">
            <a className="button primary" href={`lootden://install/${game.id}`}>
              Install on this PC
            </a>
            <p className="muted small">
              Opens the LootDen app. Or run{" "}
              <code
                role="button"
                tabIndex={0}
                onClick={() => {
                  void navigator.clipboard?.writeText(command);
                  setCopied(true);
                }}
              >
                {command}
              </code>
              {copied ? " (copied)" : ""} with the command-line client. Archives are unpacked and removed automatically.
            </p>
          </div>
          )}
        </div>
      </div>

      {m?.screenshots.length ? (
        <section className="row">
          <h2>Screenshots</h2>
          <div className="row-track shots">
            {m.screenshots.map((s) => (
              <a key={s} href={s} target="_blank" rel="noreferrer">
                <img src={s} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Files</h2>
        <table className="table">
          <tbody>
            {game.files.map((f) => (
              <tr key={f.index}>
                <td>
                  <a href={`/api/games/${game.id}/files/${f.index}`} download>
                    {f.path}
                  </a>
                </td>
                <td className="muted">{f.archive ? f.archive.toUpperCase() : ""}</td>
                <td className="num">{formatBytes(f.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <PreparePanel game={game} />

      <SavesPanel game={game} onChange={setGame} />

      {me?.role === "admin" && <AdminTools game={game} onChange={setGame} />}
    </article>
  );
}

function AdminTools({ game, onChange }: { game: Game; onChange: (g: Game) => void }) {
  const [query, setQuery] = useState(game.title);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState(game.overrides.title ?? "");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel admin-tools">
      <h2>Admin</h2>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        Folder: <code>{game.source}</code>
        {game.metadata ? ` · Metadata from ${game.metadata.provider}${game.metadata.locked ? " (matched by hand)" : ""}` : " · No metadata yet"}
      </p>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => setResults(await api.searchMetadata(game.id, query)));
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search metadata" />
        <button disabled={busy}>Find metadata</button>
        {game.metadata && (
          <button type="button" className="ghost" disabled={busy} onClick={() => run(async () => { await api.clearMetadata(game.id); onChange(await api.game(game.id)); })}>
            Clear match
          </button>
        )}
      </form>
      {results && (
        <div className="candidates">
          {results.length === 0 && <p className="muted">Nothing found.</p>}
          {results.slice(0, 12).map((c) => (
            <button
              key={`${c.provider}:${c.providerId}`}
              className="candidate"
              disabled={busy}
              onClick={() => run(async () => { onChange(await api.applyMetadata(game.id, c.provider, c.providerId)); setResults(null); })}
            >
              {c.coverUrl ? <img src={c.coverUrl} alt="" /> : <span className="cover-mini" />}
              <span>
                {c.name} {c.year ? `(${c.year})` : ""}
                <br />
                <small className="muted">
                  {c.provider} · {Math.round(c.score * 100)}% match
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="inline">
        <input placeholder="Title override" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title override" />
        <button disabled={busy} onClick={() => run(async () => onChange(await api.updateGame(game.id, { title: title || null })))}>
          {title ? "Set title" : "Reset title"}
        </button>
      </div>
      <div className="inline">
        <label>
          Kid-safe
          <select
            value={game.overrides.kidSafe === null ? "" : String(game.overrides.kidSafe)}
            onChange={(e) => run(async () => onChange(await api.updateGame(game.id, { kidSafe: e.target.value === "" ? null : e.target.value === "true" })))}
          >
            <option value="">Automatic ({game.metadata?.ageRatings.length ? (game.kidSafe ? "yes" : "no") : "unknown"})</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <label>
          Controller
          <select
            value={game.overrides.controllerSupport ?? ""}
            onChange={(e) => run(async () => onChange(await api.updateGame(game.id, { controllerSupport: e.target.value || null })))}
          >
            <option value="">Automatic ({game.metadata?.controllerSupport ?? "unknown"})</option>
            <option value="full">Full</option>
            <option value="partial">Partial</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
      <ArtworkEditor game={game} onChange={onChange} />
    </section>
  );
}
