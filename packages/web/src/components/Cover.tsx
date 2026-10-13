import { useState } from "react";
import type { GameSummary } from "@lootden/shared";

/** Cover art, or a generated tile with the title when there is none yet. */
export function Cover({ game, size = "card" }: { game: Pick<GameSummary, "id" | "title" | "coverUrl">; size?: "card" | "hero" }) {
  const [failed, setFailed] = useState(false);
  if (game.coverUrl && !failed) {
    // The game page shows the whole image at its own shape.
    if (size === "hero") return <img className="cover cover-hero cover-natural" src={game.coverUrl} alt="" onError={() => setFailed(true)} />;
    // Cards keep one shape; art of another shape is fitted whole over a blurred copy instead of cropped.
    return (
      <div className={`cover cover-${size} cover-frame`}>
        <span className="cover-blur" style={{ backgroundImage: `url("${game.coverUrl}")` }} />
        <img src={game.coverUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      </div>
    );
  }
  let hash = 0;
  for (const c of game.id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <div className={`cover cover-${size} cover-placeholder`} style={{ background: `linear-gradient(150deg, hsl(${hue} 55% 32%), hsl(${(hue + 50) % 360} 60% 18%))` }}>
      <span>{game.title}</span>
    </div>
  );
}
