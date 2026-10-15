import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { platformFor, type GameDetail } from "@lootden/shared";
import { api } from "../api";

/** Plays an emulated game in the browser. Saves sync with the desktop app through the player's save backups. */
export function PlayInBrowser() {
  const { id = "" } = useParams();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    api.game(id).then(setGame, (e: Error) => setError(e.message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  return (
    <div className="play-browser">
      <div className="inline play-bar">
        <Link to={`/games/${id}`} className="button">
          ← Back
        </Link>
        <strong>{game?.title}</strong>
        {game && <span className="muted small">{platformFor(game.platform).name} in the browser · your save syncs with the desktop app · click the game to give it the controller</span>}
        <span style={{ flex: 1 }} />
        <button onClick={() => frame.current?.contentWindow?.postMessage("lootden:save", location.origin)}>Sync save now</button>
        <button onClick={() => frame.current?.requestFullscreen()}>Fullscreen</button>
      </div>
      {/* Focused so keys and the controller go to the game, not LootDen's menus. */}
      <iframe ref={frame} onLoad={() => frame.current?.focus()} className="play-frame" src={`/api/games/${id}/play`} title={game?.title ?? "Game"} allow="fullscreen; gamepad; autoplay" allowFullScreen />
    </div>
  );
}
