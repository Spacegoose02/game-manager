import { useState } from "react";
import type { GameSummary } from "@lootden/shared";

type CoverGame = Pick<GameSummary, "id" | "title" | "coverUrl"> & { backgroundUrl?: string | null };

/**
 * Cover art. If the cover is missing or won't load, a crop of the game's background is
 * used, then a generated tile with the title.
 */
export function Cover({ game, size = "card" }: { game: CoverGame; size?: "card" | "hero" }) {
  // Failures are remembered per address, so one broken image doesn't blank the next game
  // shown in the same spot (the Featured banner reuses this component as it rotates).
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const fail = (url: string) => setFailed((s) => new Set(s).add(url));

  if (game.coverUrl && !failed.has(game.coverUrl)) {
    const url = game.coverUrl;
    // The game page shows the whole image at its own shape.
    if (size === "hero") return <img className="cover cover-hero cover-natural" src={url} alt="" onError={() => fail(url)} />;
    // Cards keep one shape; art of another shape is fitted whole over a blurred copy instead of cropped.
    return (
      <div className={`cover cover-${size} cover-frame`}>
        <span className="cover-blur" style={{ backgroundImage: `url("${url}")` }} />
        <img src={url} alt="" loading="lazy" onError={() => fail(url)} />
      </div>
    );
  }
  if (game.backgroundUrl && !failed.has(game.backgroundUrl)) {
    const url = game.backgroundUrl;
    return <img className={`cover cover-${size}`} src={url} alt="" loading={size === "hero" ? undefined : "lazy"} onError={() => fail(url)} />;
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
