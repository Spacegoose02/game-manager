import type { GameSummary } from "@game-manager/shared";

export function Badges({ game, compact = false }: { game: GameSummary; compact?: boolean }) {
  return (
    <div className={`badges${compact ? " badges-compact" : ""}`}>
      {game.controllerSupport === "full" && <span className="badge badge-pad" title="Full controller support">🎮 {compact ? "" : "Controller"}</span>}
      {game.controllerSupport === "partial" && <span className="badge badge-pad-partial" title="Partial controller support">🎮 {compact ? "½" : "Partial"}</span>}
      {game.kidSafe === true && <span className="badge badge-kid" title="Suitable for kids">{compact ? "★" : "Kid-safe"}</span>}
      {game.rating != null && !compact && <span className="badge">{game.rating}/100</span>}
      {game.packed && !compact && <span className="badge badge-muted" title="Unpacked automatically after download">Packed</span>}
    </div>
  );
}
