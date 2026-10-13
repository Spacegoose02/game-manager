import type { ControllerSupport } from "@lootden/shared";
import { pcgwPathToTemplate } from "../saves/store.js";
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

  /** Windows save locations from the game's PCGamingWiki page, as client path templates. */
  async savePaths(steamAppId: string | null, title: string): Promise<string[]> {
    const page = await this.pageName(steamAppId, title);
    if (!page) return [];
    const params = new URLSearchParams({ action: "parse", page, prop: "wikitext", format: "json", redirects: "1" });
    const r = await limitedJson<{ parse?: { wikitext?: { "*"?: string } } }>(limiter, this.fetchImpl, `https://www.pcgamingwiki.com/w/api.php?${params}`);
    const text = r.parse?.wikitext?.["*"] ?? "";
    const out: string[] = [];
    // {{Game data/saves|Windows|{{p|appdata}}\Studio\Game\|{{p|game}}\saves}}
    for (const m of text.matchAll(/\{\{Game data\/saves\|Windows\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/gi)) {
      for (const part of splitTopLevel(m[1]!)) {
        const t = pcgwPathToTemplate(part);
        if (t && !out.includes(t)) out.push(t);
      }
    }
    return out;
  }

  private async pageName(steamAppId: string | null, title: string): Promise<string | null> {
    const where = steamAppId && /^\d+$/.test(steamAppId) ? `Infobox_game.Steam_AppID HOLDS "${steamAppId}"` : `Infobox_game._pageName="${title.replace(/["\\]/g, "")}"`;
    const params = new URLSearchParams({ action: "cargoquery", tables: "Infobox_game", fields: "Infobox_game._pageName=page", where, format: "json", limit: "1" });
    const r = await limitedJson<{ cargoquery?: Array<{ title: { page?: string } }> }>(limiter, this.fetchImpl, `https://www.pcgamingwiki.com/w/api.php?${params}`);
    return r.cargoquery?.[0]?.title.page ?? null;
  }
}

/** Splits "a|{{p|b}}|c" on pipes that aren't inside a template. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("{{", i)) depth++;
    if (s.startsWith("}}", i)) depth--;
    if (s[i] === "|" && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += s[i];
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}
