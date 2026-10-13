import type { ControllerSupport } from "@game-manager/shared";
import { limitedJson, RateLimiter, type FetchLike } from "./http.js";

const limiter = new RateLimiter(1000);

/** Controller support from PCGamingWiki's Input table, looked up by Steam app id. */
export class PcGamingWiki {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async controllerSupport(steamAppId: string): Promise<ControllerSupport | null> {
    if (!/^\d+$/.test(steamAppId)) return null;
    const params = new URLSearchParams({
      action: "cargoquery",
      tables: "Infobox_game,Input",
      join_on: "Infobox_game._pageID=Input._pageID",
      fields: "Input.Controller_support=controller,Input.Full_controller_support=full",
      where: `Infobox_game.Steam_AppID HOLDS "${steamAppId}"`,
      format: "json",
      limit: "1",
    });
    const r = await limitedJson<{ cargoquery?: Array<{ title: { controller?: string; full?: string } }> }>(
      limiter,
      this.fetchImpl,
      `https://www.pcgamingwiki.com/w/api.php?${params}`,
    );
    const row = r.cargoquery?.[0]?.title;
    if (!row) return null;
    if (row.full === "true") return "full";
    if (row.controller === "true" || row.controller === "limited") return "partial";
    if (row.controller === "false") return "none";
    return null;
  }
}
