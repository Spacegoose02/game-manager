import { titleKey } from "../metadata/calendar.js";
import type { FetchLike } from "../metadata/http.js";

export interface NexusMod {
  id: number;
  name: string;
  summary: string;
  picture: string | null;
  author: string;
  endorsements: number;
  url: string;
}

const DAY = 24 * 3600_000;

const EDITION = /[\s:-]*(?:\(?(?:game of the year|goty|definitive|complete|deluxe|ultimate|gold|enhanced|anniversary|remastered|director'?s cut)(?: edition)?\)?)$/i;

/** The title as is, then without an edition suffix, then without its subtitle. */
export function titleCandidates(title: string): string[] {
  const out = [title, title.replace(EDITION, ""), title.split(/\s*[:\u2013\u2014]\s*|\s+-\s+/)[0]!];
  return [...new Set(out.map(titleKey).filter(Boolean))];
}

/** Trending mods from NexusMods for a game, with the admin's personal API key. */
export class NexusMods {
  private games: { at: number; list: Array<{ name: string; domain_name: string }> } | null = null;
  private trending = new Map<string, { at: number; mods: NexusMod[] }>();

  constructor(
    private readonly key: () => string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get enabled(): boolean {
    return !!this.key();
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`https://api.nexusmods.com/v1/${path}`, { headers: { apikey: this.key(), Accept: "application/json", "Application-Name": "LootDen" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401) throw new Error("NexusMods didn't accept the API key");
    if (!res.ok) throw new Error(`NexusMods answered ${res.status}`);
    return (await res.json()) as T;
  }

  /** Checks the key and names the account it belongs to. */
  async test(): Promise<string> {
    if (!this.enabled) throw new Error("Add a NexusMods API key first");
    const me = await this.get<{ name?: string; is_premium?: boolean }>("users/validate.json");
    return `NexusMods key works${me.name ? ` (signed in as ${me.name})` : ""}. Trending mods now show on PC game pages.`;
  }

  /**
   * NexusMods' short name for a game ("skyrimspecialedition"), matched on the title. A library
   * title often carries a subtitle or edition NexusMods leaves off ("The Witcher 3: Wild Hunt",
   * "Fallout 4 GOTY"), so those are tried too, after the exact title.
   */
  async domainFor(title: string): Promise<string | null> {
    if (!this.games || Date.now() - this.games.at > DAY) this.games = { at: Date.now(), list: await this.get("games.json") };
    const byKey = new Map<string, string>();
    for (const g of this.games.list) if (!byKey.has(titleKey(g.name))) byKey.set(titleKey(g.name), g.domain_name);
    for (const key of titleCandidates(title)) {
      const hit = byKey.get(key);
      if (hit) return hit;
    }
    return null;
  }

  async forTitle(title: string): Promise<{ domain: string | null; mods: NexusMod[] }> {
    if (!this.enabled) return { domain: null, mods: [] };
    const domain = await this.domainFor(title);
    if (!domain) return { domain: null, mods: [] };
    const hit = this.trending.get(domain);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return { domain, mods: hit.mods };
    const raw = await this.get<Array<{ mod_id: number; name?: string; summary?: string; picture_url?: string; author?: string; endorsement_count?: number; contains_adult_content?: boolean; available?: boolean; status?: string }>>(
      `games/${domain}/mods/trending.json`,
    );
    const mods = raw
      .filter((m) => m.available !== false && m.status !== "hidden" && !m.contains_adult_content && m.name)
      .slice(0, 12)
      .map((m) => ({
        id: m.mod_id,
        name: m.name!,
        summary: (m.summary ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").slice(0, 240),
        picture: m.picture_url ?? null,
        author: m.author ?? "",
        endorsements: m.endorsement_count ?? 0,
        url: `https://www.nexusmods.com/${domain}/mods/${m.mod_id}`,
      }));
    this.trending.set(domain, { at: Date.now(), mods });
    return { domain, mods };
  }
}
