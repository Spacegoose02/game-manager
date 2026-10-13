import { useState } from "react";
import type { GameSummary } from "@lootden/shared";

/** Cover art, or a generated tile with the title when there is none yet. */
export function Cover({ game, size = "card" }: { game: Pick<GameSummary, "id" | "title" | "coverUrl">; size?: "card" | "hero" }) {
  const [failed, setFailed] = useState(false);
  if (game.coverUrl && !failed) {
    return <img className={`cover cover-${size}`} src={game.coverUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
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
