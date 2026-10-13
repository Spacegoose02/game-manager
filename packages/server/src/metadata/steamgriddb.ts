import { limitedJson, RateLimiter, type FetchLike } from "./http.js";

const limiter = new RateLimiter(250);
const API = "https://www.steamgriddb.com/api/v2";

export interface ArtworkOption {
  url: string;
  thumb: string;
  width: number;
  height: number;
  source: string;
}

interface Asset {
  url: string;
  thumb: string;
  width: number;
  height: number;
}

/**
 * SteamGridDB: community artwork (portrait covers, wide backgrounds). Needs a free API
 * key from steamgriddb.com/profile/preferences/api. Used to fill missing covers and to
 * offer replacements for ugly ones.
 */
export class SteamGridDb {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get enabled(): boolean {
    return !!this.apiKey;
  }

  private get<T>(path: string): Promise<{ success: boolean; data: T }> {
    return limitedJson(limiter, this.fetchImpl, `${API}${path}`, { headers: { Authorization: `Bearer ${this.apiKey}` } });
  }

  /** SteamGridDB's game id, by Steam app id when known (exact), else by name. */
  async gameId(name: string, steamAppId: string | null): Promise<number | null> {
    if (steamAppId) {
      const r = await this.get<{ id: number }>(`/games/steam/${encodeURIComponent(steamAppId)}`).catch(() => null);
      if (r?.data?.id) return r.data.id;
    }
    const r = await this.get<Array<{ id: number; name: string }>>(`/search/autocomplete/${encodeURIComponent(name)}`);
    return r.data[0]?.id ?? null;
  }

  async search(name: string): Promise<Array<{ id: number; name: string }>> {
    return (await this.get<Array<{ id: number; name: string }>>(`/search/autocomplete/${encodeURIComponent(name)}`)).data;
  }

  async covers(gameId: number): Promise<ArtworkOption[]> {
    const r = await this.get<Asset[]>(`/grids/game/${gameId}?dimensions=600x900,342x482,660x930&types=static`);
    return r.data.map((a) => ({ url: a.url, thumb: a.thumb, width: a.width, height: a.height, source: "steamgriddb" }));
  }

  async backgrounds(gameId: number): Promise<ArtworkOption[]> {
    const r = await this.get<Asset[]>(`/heroes/game/${gameId}?types=static`);
    return r.data.map((a) => ({ url: a.url, thumb: a.thumb, width: a.width, height: a.height, source: "steamgriddb" }));
  }
}
