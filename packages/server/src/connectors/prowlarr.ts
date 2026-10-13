import type { FetchLike } from "../metadata/http.js";
import type { ConnectorSettings } from "./settings.js";

export interface SearchResult {
  guid: string;
  title: string;
  sizeBytes: number;
  indexer: string;
  protocol: "torrent" | "usenet";
  /** What to hand to the download client: magnet link or .torrent/.nzb URL. */
  downloadUrl: string;
  infoUrl: string | null;
  seeders: number | null;
  leechers: number | null;
  publishedAt: string | null;
}

interface ProwlarrResult {
  guid: string;
  title: string;
  size: number;
  indexer: string;
  protocol: string;
  downloadUrl?: string;
  magnetUrl?: string;
  infoUrl?: string;
  seeders?: number;
  leechers?: number;
  publishDate?: string;
}

/**
 * Searches the indexers configured in Prowlarr (torrent and usenet). Sites behind
 * Cloudflare are handled by Prowlarr itself through a FlareSolverr indexer proxy.
 */
export class ProwlarrClient {
  constructor(
    private readonly s: ConnectorSettings["prowlarr"],
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get configured(): boolean {
    return !!(this.s.url && this.s.apiKey);
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.s.url}${path}`, { headers: { "X-Api-Key": this.s.apiKey }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Prowlarr answered ${res.status}`);
    return (await res.json()) as T;
  }

  async test(): Promise<string> {
    const r = await this.get<{ version: string }>("/api/v1/system/status");
    return `Prowlarr ${r.version}`;
  }

  async search(query: string): Promise<SearchResult[]> {
    const q = new URLSearchParams({ query, type: "search" });
    for (const c of this.s.categories) q.append("categories", String(c));
    const results = await this.get<ProwlarrResult[]>(`/api/v1/search?${q}`);
    return results
      .filter((r) => r.magnetUrl || r.downloadUrl)
      .map((r) => ({
        guid: r.guid,
        title: r.title,
        sizeBytes: r.size,
        indexer: r.indexer,
        protocol: (r.protocol === "usenet" ? "usenet" : "torrent") as SearchResult["protocol"],
        downloadUrl: (r.magnetUrl || r.downloadUrl)!,
        infoUrl: r.infoUrl ?? null,
        seeders: r.seeders ?? null,
        leechers: r.leechers ?? null,
        publishedAt: r.publishDate ?? null,
      }))
      .sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0));
  }
}
