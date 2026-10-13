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

  /** NexusMods' short name for a game ("skyrimspecialedition"), matched on the title. */
  async domainFor(title: string): Promise<string | null> {
    if (!this.games || Date.now() - this.games.at > DAY) this.games = { at: Date.now(), list: await this.get("games.json") };
    const key = titleKey(title);
    return this.games.list.find((g) => titleKey(g.name) === key)?.domain_name ?? null;
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
