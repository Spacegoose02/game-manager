import type { ControllerSupport } from "@lootden/shared";
import { limitedJson, RateLimiter, type FetchLike } from "./http.js";
import type { Candidate, MetadataProvider, ProviderResult } from "./types.js";

// The store API allows roughly 200 requests per 5 minutes per IP.
const limiter = new RateLimiter(1600);

const FULL_CONTROLLER = 28;
const PARTIAL_CONTROLLER = 18;

interface AppDetails {
  type?: string;
  name: string;
  steam_appid: number;
  required_age?: number | string;
  short_description?: string;
  header_image?: string;
  screenshots?: Array<{ path_full: string }>;
  genres?: Array<{ description: string }>;
  categories?: Array<{ id: number; description: string }>;
  release_date?: { date?: string };
  metacritic?: { score?: number };
}

export const steamCover = (appId: string) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
export const steamHeader = (appId: string) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;

export function controllerFromCategories(categories: Array<{ id: number }> | undefined): ControllerSupport | null {
  if (!categories) return null;
  if (categories.some((c) => c.id === FULL_CONTROLLER)) return "full";
  if (categories.some((c) => c.id === PARTIAL_CONTROLLER)) return "partial";
  return null; // Steam only tags support, so a missing tag is "unknown", not "none"
}

/** Free, keyless metadata from the Steam store. Used alone when no IGDB keys are set, and for controller support. */
export class SteamProvider implements MetadataProvider {
  readonly name = "steam";
  readonly enabled = true;

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async search(query: string): Promise<Candidate[]> {
    const r = await limitedJson<{ items?: Array<{ id: number; name: string; type?: string }> }>(
      limiter,
      this.fetchImpl,
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=us&l=english`,
    );
    return (r.items ?? [])
      .filter((i) => !i.type || i.type === "app")
      .map((i) => ({ provider: this.name, providerId: String(i.id), name: i.name, year: null, coverUrl: steamCover(String(i.id)) }));
  }

  async details(appId: string): Promise<AppDetails | null> {
    if (!/^\d+$/.test(appId)) return null;
    const r = await limitedJson<Record<string, { success: boolean; data?: AppDetails }>>(
      limiter,
      this.fetchImpl,
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`,
    );
    const entry = r[appId];
    return entry?.success && entry.data ? entry.data : null;
  }

  async fetch(id: string): Promise<ProviderResult | null> {
    const d = await this.details(id);
    if (!d) return null;
    const parsed = d.release_date?.date ? new Date(`${d.release_date.date} UTC`) : null;
    const age = Number(d.required_age) || 0;
    return {
      provider: this.name,
      providerId: String(d.steam_appid),
      name: d.name,
      summary: d.short_description ? d.short_description.replace(/<[^>]+>/g, "").trim() : null,
      coverUrl: steamCover(String(d.steam_appid)),
      screenshots: (d.screenshots ?? []).slice(0, 8).map((s) => s.path_full),
      genres: (d.genres ?? []).map((g) => g.description),
      themes: [],
      gameModes: (d.categories ?? [])
        .map((c) => c.description)
        .filter((c) => /single-player|multi-player|co-op|pvp|online|lan/i.test(c)),
      releaseDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null,
      rating: d.metacritic?.score ?? null,
      ageRatings: age > 0 ? [{ organization: "STEAM", rating: `${age}+` }] : [],
      controllerSupport: controllerFromCategories(d.categories),
      steamAppId: String(d.steam_appid),
    };
  }
}
