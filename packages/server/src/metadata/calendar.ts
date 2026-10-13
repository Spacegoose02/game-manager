import type { GameInfo, GameListing } from "@lootden/shared";
import { gameInfo } from "./details.js";
import type { Library } from "../catalog/library.js";
import { limitedJson, RateLimiter, type FetchLike } from "./http.js";
import { igdbImage } from "./igdb.js";
import type { MetadataService } from "./service.js";
import { steamCover, steamHeader } from "./steam.js";

const CACHE_MS = 6 * 3600_000;
const steamLimiter = new RateLimiter(1600);

interface IgdbRelease {
  id: number;
  name: string;
  first_release_date?: number;
  cover?: { image_id: string };
  artworks?: Array<{ image_id: string }>;
  screenshots?: Array<{ image_id: string }>;
  platforms?: Array<{ abbreviation?: string; name?: string }>;
  genres?: Array<{ name: string }>;
  url?: string;
}

/** Loose title key: "The Witcher 3: Wild Hunt" and "witcher 3 wild hunt" match. */
export const titleKey = (t: string) => t.toLowerCase().replace(/[™®©]/g, "").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");

const day = (d: Date) => d.toISOString().slice(0, 10);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Steam's "Nov 14, 2026" / "14 Nov, 2026" to YYYY-MM-DD; anything vaguer stays text. */
export function steamDate(text: string): string | null {
  const t = text.trim().toLowerCase().replace(",", "");
  let m = t.match(/^([a-z]{3})[a-z]* (\d{1,2}) (\d{4})$/);
  if (m) {
    const mon = MONTHS.indexOf(m[1]!);
    return mon < 0 ? null : `${m[3]}-${String(mon + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})$/);
  if (m) {
    const mon = MONTHS.indexOf(m[2]!);
    return mon < 0 ? null : `${m[3]}-${String(mon + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

/** Pulls rows out of the Steam store search results HTML (the store has no JSON for this). */
export function parseSteamSearch(html: string): Array<{ appId: string; name: string; released: string }> {
  const out: Array<{ appId: string; name: string; released: string }> = [];
  for (const row of html.split(/<a\s+href="https:\/\/store\.steampowered\.com\/app\//).slice(1)) {
    const appId = row.match(/^(\d+)/)?.[1];
    const name = row.match(/<span class="title">([^<]*)<\/span>/)?.[1];
    const released = row.match(/class="search_released[^"]*">\s*([^<]*?)\s*<\/div>/)?.[1] ?? "";
    if (appId && name) out.push({ appId, name: decode(name), released: decode(released) });
  }
  return out;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/**
 * Upcoming releases and "what's new" lists for the calendar and Discover pages.
 * Uses IGDB when keys are set, then RAWG, then the keyless Steam store. Cached for 6 hours.
 */
export class ReleaseCalendar {
  private cache = new Map<string, { at: number; items: GameListing[]; source: string }>();
  private infoCache = new Map<string, { at: number; info: GameInfo | null }>();

  constructor(
    private readonly metadata: MetadataService,
    private readonly library: Library,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /** Drops cached lists, e.g. after API keys change. */
  reset(): void {
    this.cache.clear();
    this.infoCache.clear();
  }

  private async cached(key: string, load: () => Promise<{ items: GameListing[]; source: string }>) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit, items: this.markLibrary(hit.items) };
    const fresh = await load();
    this.cache.set(key, { at: Date.now(), ...fresh });
    return { ...fresh, items: this.markLibrary(fresh.items) };
  }

  /** Links listings to library games with the same title. */
  markLibrary(items: GameListing[]): GameListing[] {
    const byTitle = new Map<string, string>();
    for (const g of this.library.list({})) byTitle.set(titleKey(g.title), g.id);
    return items.map((i) => ({ ...i, libraryId: byTitle.get(titleKey(i.name)) ?? null }));
  }

  /** Releases from `pastDays` ago through the next `days` days, soonest first. */
  async upcoming(days = 120, platform: "pc" | "all" = "pc", pastDays = 0) {
    const next = await this.between(0, days, platform);
    if (pastDays <= 0) return next;
    const past = await this.between(-pastDays, 0, platform);
    const seen = new Set(next.items.map((i) => `${i.provider}:${i.providerId}`));
    return { ...next, items: [...past.items.filter((i) => !seen.has(`${i.provider}:${i.providerId}`)), ...next.items] };
  }

  /** Releases between two day offsets from today (negative is the past). */
  private between(fromDay: number, toDay: number, platform: "pc" | "all") {
    return this.cached(`between:${fromDay}:${toDay}:${platform}`, async () => {
      const from = new Date(Date.now() + fromDay * 86400_000);
      const to = new Date(Date.now() + toDay * 86400_000);
      const { igdb, rawg } = this.metadata;
      if (igdb.enabled) {
        const where = [
          `first_release_date >= ${Math.floor(from.getTime() / 1000)}`,
          `first_release_date < ${Math.floor(to.getTime() / 1000)}`,
          "version_parent = null",
          "themes != (42)",
          "hypes >= 1",
          ...(platform === "pc" ? ["platforms = (6)"] : []),
        ].join(" & ");
        const rows = await igdb.raw<IgdbRelease>(
          "games",
          `fields name,first_release_date,cover.image_id,artworks.image_id,screenshots.image_id,platforms.abbreviation,platforms.name,genres.name,url; where ${where}; sort first_release_date asc; limit 300;`,
        );
        return { source: "IGDB", items: rows.map(fromIgdb) };
      }
      if (rawg.enabled) {
        const items: GameListing[] = [];
        for (let page = 1; page <= 3; page++) {
          const r = await rawg.list({ dates: `${day(from)},${day(to)}`, ordering: "released", page_size: "40", page: String(page), ...(platform === "pc" ? { platforms: "4" } : {}) });
          items.push(...r.results.map(fromRawg));
          if (r.results.length < 40) break;
        }
        return { source: "RAWG", items };
      }
      // Steam has no date search: "coming soon" for the future, "popular new" for the past.
      if (fromDay >= 0) return { source: "Steam", items: await this.steamSearch("comingsoon") };
      const since = day(from);
      return { source: "Steam", items: (await this.steamSearch("popularnew")).filter((i) => i.releaseDate && i.releaseDate >= since) };
    });
  }

  /** Games released in the last few months that people are playing, newest and most popular first. */
  recent(days = 90) {
    return this.cached(`recent:${days}`, async () => {
      const to = new Date();
      const from = new Date(Date.now() - days * 86400_000);
      const { igdb, rawg } = this.metadata;
      if (igdb.enabled) {
        const where = [
          `first_release_date >= ${Math.floor(from.getTime() / 1000)}`,
          `first_release_date <= ${Math.floor(to.getTime() / 1000)}`,
          "version_parent = null",
          "themes != (42)",
          "platforms = (6)",
          "(hypes >= 1 | total_rating_count >= 1)",
        ].join(" & ");
        const rows = await igdb.raw<IgdbRelease>(
          "games",
          `fields name,first_release_date,cover.image_id,artworks.image_id,screenshots.image_id,platforms.abbreviation,platforms.name,genres.name,url; where ${where}; sort first_release_date desc; limit 60;`,
        );
        return { source: "IGDB", items: rows.map(fromIgdb) };
      }
      if (rawg.enabled) {
        const r = await rawg.list({ dates: `${day(from)},${day(to)}`, ordering: "-added", page_size: "40", platforms: "4" });
        return { source: "RAWG", items: r.results.map(fromRawg) };
      }
      return { source: "Steam", items: await this.steamSearch("popularnew") };
    });
  }

  /** Full details for the Discover game page, cached like the lists. */
  async info(provider: string, id: string): Promise<GameInfo | null> {
    const key = `info:${provider}:${id}`;
    const hit = this.infoCache.get(key);
    const fresh = hit && Date.now() - hit.at < CACHE_MS ? hit.info : await gameInfo(this.metadata, provider, id);
    if (!hit || hit.info !== fresh) this.infoCache.set(key, { at: Date.now(), info: fresh });
    if (!fresh) return null;
    const [marked] = this.markLibrary([fresh]);
    return { ...fresh, libraryId: marked!.libraryId };
  }

  private async steamSearch(filter: "comingsoon" | "popularnew"): Promise<GameListing[]> {
    const params = new URLSearchParams({ filter, category1: "998", count: filter === "popularnew" ? "100" : "60", start: "0", infinite: "1", cc: "us", l: "english" });
    const r = await limitedJson<{ results_html?: string }>(steamLimiter, this.fetchImpl, `https://store.steampowered.com/search/results/?${params}`);
    const rows = parseSteamSearch(r.results_html ?? "");
    const items = rows.map((x) => {
      const date = steamDate(x.released);
      return {
        provider: "steam",
        providerId: x.appId,
        name: x.name,
        releaseDate: date,
        dateText: date ? null : x.released || "Coming soon",
        coverUrl: steamCover(x.appId),
        imageUrl: steamHeader(x.appId),
        platforms: ["PC"],
        genres: [],
        url: `https://store.steampowered.com/app/${x.appId}/`,
        libraryId: null,
      };
    });
    if (filter === "comingsoon") items.sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"));
    // "Popular new" also lists evergreen hits (Dota 2, CS2); keep the ones released lately, in popularity order.
    if (filter === "popularnew") {
      const since = day(new Date(Date.now() - 120 * 86400_000));
      const today = day(new Date());
      return items.filter((i) => i.releaseDate && i.releaseDate >= since && i.releaseDate <= today);
    }
    return items;
  }
}

function fromIgdb(g: IgdbRelease): GameListing {
  const wide = g.artworks?.[0] ?? g.screenshots?.[0];
  return {
    provider: "igdb",
    providerId: String(g.id),
    name: g.name,
    releaseDate: g.first_release_date ? day(new Date(g.first_release_date * 1000)) : null,
    dateText: null,
    coverUrl: g.cover ? igdbImage(g.cover.image_id, "t_cover_big") : null,
    imageUrl: wide ? igdbImage(wide.image_id, "t_screenshot_big") : null,
    platforms: (g.platforms ?? []).map((p) => p.abbreviation ?? p.name ?? "").filter(Boolean),
    genres: (g.genres ?? []).map((x) => x.name),
    url: g.url ?? null,
    libraryId: null,
  };
}

function fromRawg(g: { id: number; name: string; slug?: string; released?: string | null; background_image?: string | null; genres?: Array<{ name: string }>; platforms?: Array<{ platform: { name: string } }> }): GameListing {
  return {
    provider: "rawg",
    providerId: String(g.id),
    name: g.name,
    releaseDate: g.released ?? null,
    dateText: g.released ? null : "TBA",
    coverUrl: null,
    imageUrl: g.background_image ?? null,
    platforms: (g.platforms ?? []).map((p) => p.platform.name),
    genres: (g.genres ?? []).map((x) => x.name),
    url: g.slug ? `https://rawg.io/games/${g.slug}` : null,
    libraryId: null,
  };
}
