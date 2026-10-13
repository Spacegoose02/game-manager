import type { AgeRating, Platform } from "@lootden/shared";
import { HttpError, limitedJson, RateLimiter, type FetchLike } from "./http.js";
import type { Candidate, MetadataProvider, ProviderResult } from "./types.js";

// IGDB allows 4 requests per second per client; stay a little under it.
const limiter = new RateLimiter(300);
const tokenLimiter = new RateLimiter(1000);

// Current schema (2025+): age ratings and external games reference lookup tables.
const FIELDS =
  "name,summary,first_release_date,total_rating,cover.image_id,screenshots.image_id,genres.name,themes.name,game_modes.name,platforms," +
  "age_ratings.organization.name,age_ratings.rating_category.rating,external_games.uid,external_games.external_game_source";
// Older schema with enum fields, used if the current one is rejected.
const LEGACY_FIELDS =
  "name,summary,first_release_date,total_rating,cover.image_id,screenshots.image_id,genres.name,themes.name,game_modes.name,platforms," +
  "age_ratings.category,age_ratings.rating,external_games.uid,external_games.category";

const PC = 6;
const STEAM_SOURCE = 1;
const LEGACY_ORGS: Record<number, string> = { 1: "ESRB", 2: "PEGI", 3: "CERO", 4: "USK", 5: "GRAC", 6: "CLASS_IND", 7: "ACB" };
const LEGACY_RATINGS: Record<number, string> = {
  1: "3", 2: "7", 3: "12", 4: "16", 5: "18", 6: "RP", 7: "EC", 8: "E", 9: "E10+", 10: "T", 11: "M", 12: "AO",
  13: "A", 14: "B", 15: "C", 16: "D", 17: "Z", 18: "0", 19: "6", 20: "12", 21: "16", 22: "18",
  23: "ALL", 24: "12", 25: "15", 26: "18", 27: "TESTING", 28: "L", 29: "10", 30: "12", 31: "14", 32: "16", 33: "18",
  34: "G", 35: "PG", 36: "M", 37: "MA15+", 38: "R18+", 39: "RC",
};
const WORD_RATINGS: Record<string, string> = { THREE: "3", SEVEN: "7", TWELVE: "12", SIXTEEN: "16", EIGHTEEN: "18", E10: "E10+" };

interface IgdbGame {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number;
  total_rating?: number;
  cover?: { image_id: string };
  screenshots?: Array<{ image_id: string }>;
  genres?: Array<{ name: string }>;
  themes?: Array<{ name: string }>;
  game_modes?: Array<{ name: string }>;
  platforms?: number[];
  age_ratings?: Array<{
    organization?: { name?: string };
    rating_category?: { rating?: string };
    category?: number;
    rating?: number;
  }>;
  external_games?: Array<{ uid?: string; external_game_source?: number; category?: number }>;
}

export const igdbImage = (id: string, size: "t_cover_big" | "t_screenshot_big" | "t_1080p") =>
  `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg`;

export class IgdbProvider implements MetadataProvider {
  readonly name = "igdb";
  private token: { value: string; expires: number } | null = null;
  private legacy = false;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get enabled(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(this.clientId)}&client_secret=${encodeURIComponent(this.clientSecret)}&grant_type=client_credentials`;
    const r = await limitedJson<{ access_token: string; expires_in: number }>(tokenLimiter, this.fetchImpl, url, { method: "POST" });
    this.token = { value: r.access_token, expires: Date.now() + r.expires_in * 1000 };
    return r.access_token;
  }

  private async query(body: (fields: string) => string): Promise<IgdbGame[]> {
    const run = async () =>
      limitedJson<IgdbGame[]>(limiter, this.fetchImpl, "https://api.igdb.com/v4/games", {
        method: "POST",
        headers: { "Client-ID": this.clientId, Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "text/plain" },
        body: body(this.legacy ? LEGACY_FIELDS : FIELDS),
      });
    try {
      return await run();
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        this.token = null;
        return run();
      }
      if (err instanceof HttpError && err.status === 400 && !this.legacy) {
        this.legacy = true;
        return run();
      }
      throw err;
    }
  }

  /** Raw Apicalypse query against any IGDB endpoint, with the same token handling as matching. */
  async raw<T>(endpoint: string, body: string): Promise<T[]> {
    const run = async () =>
      limitedJson<T[]>(limiter, this.fetchImpl, `https://api.igdb.com/v4/${endpoint}`, {
        method: "POST",
        headers: { "Client-ID": this.clientId, Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "text/plain" },
        body,
      });
    try {
      return await run();
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        this.token = null;
        return run();
      }
      throw err;
    }
  }

  async search(query: string, platform?: Platform): Promise<Candidate[]> {
    const q = query.replace(/["\\]/g, " ");
    const only = platform?.igdb && platform.igdb !== PC ? ` & platforms = (${platform.igdb})` : "";
    const games = await this.query((f) => `search "${q}"; fields ${f}; where version_parent = null${only}; limit 15;`);
    // PC releases first for PC games.
    if (!only) games.sort((a, b) => Number(b.platforms?.includes(PC) ?? false) - Number(a.platforms?.includes(PC) ?? false));
    return games.map((g) => ({
      provider: this.name,
      providerId: String(g.id),
      name: g.name,
      year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
      coverUrl: g.cover ? igdbImage(g.cover.image_id, "t_cover_big") : null,
    }));
  }

  async fetch(id: string): Promise<ProviderResult | null> {
    if (!/^\d+$/.test(id)) return null;
    const [g] = await this.query((f) => `fields ${f}; where id = ${id};`);
    return g ? this.toResult(g) : null;
  }

  private toResult(g: IgdbGame): ProviderResult {
    const ageRatings: AgeRating[] = [];
    for (const a of g.age_ratings ?? []) {
      let org = a.organization?.name;
      let rating = a.rating_category?.rating;
      if (!org && a.category) org = LEGACY_ORGS[a.category];
      if (!rating && a.rating) rating = LEGACY_RATINGS[a.rating];
      if (!org || !rating) continue;
      rating = rating.replace(new RegExp(`^${org}[ _]?`, "i"), "");
      ageRatings.push({ organization: org.toUpperCase(), rating: WORD_RATINGS[rating.toUpperCase()] ?? rating });
    }
    const steam = g.external_games?.find((e) => (e.external_game_source ?? e.category) === STEAM_SOURCE && e.uid);
    return {
      provider: this.name,
      providerId: String(g.id),
      name: g.name,
      summary: g.summary ?? null,
      coverUrl: g.cover ? igdbImage(g.cover.image_id, "t_cover_big") : null,
      screenshots: (g.screenshots ?? []).slice(0, 8).map((s) => igdbImage(s.image_id, "t_screenshot_big")),
      genres: (g.genres ?? []).map((x) => x.name),
      themes: (g.themes ?? []).map((x) => x.name),
      gameModes: (g.game_modes ?? []).map((x) => x.name),
      releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
      rating: g.total_rating ?? null,
      ageRatings,
      controllerSupport: null,
      steamAppId: steam?.uid ?? null,
    };
  }
}
