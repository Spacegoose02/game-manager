import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GameMetadata } from "@lootden/shared";
import type { Library } from "../catalog/library.js";
import type { ScannedGame } from "../catalog/scanner.js";
import { now, type Db } from "../db/database.js";
import type { FetchLike } from "./http.js";
import type { ServerConfig } from "../config.js";
import { IgdbProvider } from "./igdb.js";
import { RawgProvider } from "./rawg.js";
import { SteamGridDb, type ArtworkOption } from "./steamgriddb.js";
import { PcGamingWiki } from "./pcgamingwiki.js";
import { steamCover, steamHeader, SteamProvider } from "./steam.js";
import { cleanTitle, matchScore } from "./titles.js";
import type { Candidate, MetadataProvider, ProviderResult } from "./types.js";

/** Below this score a match is left for an admin to pick by hand. */
export const AUTO_MATCH_THRESHOLD = 0.6;
const RETRY_UNMATCHED_DAYS = 7;

export interface MetadataStatus {
  providers: string[];
  queued: number;
  running: boolean;
  matched: number;
  unmatched: number;
}

export type ArtworkKind = "cover" | "background";

export class MetadataService {
  igdb!: IgdbProvider;
  rawg!: RawgProvider;
  steamgriddb!: SteamGridDb;
  readonly steam: SteamProvider;
  readonly pcgw: PcGamingWiki;
  private queue: string[] = [];
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly library: Library,
    private readonly dataDir: string,
    private readonly config: Pick<ServerConfig, "igdb" | "rawg" | "steamgriddb">,
    private readonly log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.steam = new SteamProvider(fetchImpl);
    this.pcgw = new PcGamingWiki(fetchImpl);
    this.configure();
  }

  /** (Re)creates the keyed providers from the current config, e.g. after keys change in the UI. */
  configure(): void {
    this.igdb = new IgdbProvider(this.config.igdb.clientId, this.config.igdb.clientSecret, this.fetchImpl);
    this.rawg = new RawgProvider(this.config.rawg.apiKey, this.fetchImpl);
    this.steamgriddb = new SteamGridDb(this.config.steamgriddb.apiKey, this.fetchImpl);
  }

  /** IGDB and RAWG when keys are set, then the keyless Steam store. */
  get providers(): MetadataProvider[] {
    return [this.igdb, this.rawg, this.steam].filter((p) => p.enabled);
  }

  /** Checks a keyed service answers, for the Test buttons in the admin UI. */
  async test(name: string): Promise<string> {
    if (name === "igdb") {
      if (!this.igdb.enabled) throw new Error("Enter the IGDB client ID and secret first");
      return `IGDB found ${(await this.igdb.search("Portal")).length} results for "Portal"`;
    }
    if (name === "rawg") {
      if (!this.rawg.enabled) throw new Error("Enter the RAWG API key first");
      return `RAWG found ${(await this.rawg.search("Portal")).length} results for "Portal"`;
    }
    if (name === "steamgriddb") {
      if (!this.steamgriddb.enabled) throw new Error("Enter the SteamGridDB API key first");
      return `SteamGridDB found ${(await this.steamgriddb.search("Portal")).length} results for "Portal"`;
    }
    throw new Error(`Unknown service ${name}`);
  }

  provider(name: string): MetadataProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  status(): MetadataStatus {
    const matched = (this.db.prepare("SELECT COUNT(*) AS n FROM metadata").get() as { n: number }).n;
    return {
      providers: this.providers.map((p) => p.name),
      queued: this.queue.length,
      running: this.running,
      matched,
      unmatched: Math.max(0, this.library.allScanned().length - matched),
    };
  }

  /** Queues games that have no metadata and were not tried recently. */
  queueMissing(games: ScannedGame[], force = false): number {
    const cutoff = new Date(Date.now() - RETRY_UNMATCHED_DAYS * 86400_000).toISOString();
    const have = new Set((this.db.prepare("SELECT game_id FROM metadata").all() as Array<{ game_id: string }>).map((r) => r.game_id));
    const tried = new Set(
      (this.db.prepare("SELECT game_id FROM metadata_attempts WHERE attempted_at > ?").all(cutoff) as Array<{ game_id: string }>).map((r) => r.game_id),
    );
    const ids = games.filter((g) => !have.has(g.id) && (force || !tried.has(g.id))).map((g) => g.id);
    return this.enqueue(ids);
  }

  enqueue(ids: string[]): number {
    const fresh = ids.filter((id) => !this.queue.includes(id));
    this.queue.push(...fresh);
    void this.drain();
    return fresh.length;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        try {
          await this.autoMatch(id);
        } catch (err) {
          this.recordAttempt(id, (err as Error).message);
          this.log.warn({ gameId: id, err: (err as Error).message }, "Metadata lookup failed");
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Waits for the queue to empty (tests, CLI). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length) await new Promise((r) => setTimeout(r, 20));
  }

  private recordAttempt(gameId: string, error: string | null): void {
    this.db
      .prepare("INSERT INTO metadata_attempts (game_id, attempted_at, error) VALUES (?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET attempted_at = excluded.attempted_at, error = excluded.error")
      .run(gameId, now(), error);
  }

  /** Searches every enabled provider for a game, best matches first. */
  async search(query: string, year: number | null = null): Promise<Array<Candidate & { score: number }>> {
    const clean = { query, year };
    const results: Array<Candidate & { score: number }> = [];
    for (const p of this.providers) {
      try {
        for (const c of await p.search(query)) results.push({ ...c, score: matchScore(clean, c) });
      } catch (err) {
        this.log.warn({ provider: p.name, err: (err as Error).message }, "Metadata search failed");
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }

  async autoMatch(gameId: string): Promise<GameMetadata | null> {
    const game = this.library.scannedGame(gameId);
    if (!game) return null;
    const existing = this.db.prepare("SELECT locked FROM metadata WHERE game_id = ?").get(gameId) as { locked: number } | undefined;
    if (existing?.locked) return null;

    const clean = cleanTitle(game.source);
    for (const p of this.providers) {
      const candidates = (await p.search(clean.query)).map((c) => ({ ...c, score: matchScore(clean, c) }));
      const best = candidates.sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= AUTO_MATCH_THRESHOLD) {
        const result = await p.fetch(best.providerId);
        if (result) {
          this.log.info({ gameId, provider: p.name, name: result.name, score: best.score.toFixed(2) }, "Metadata matched");
          return this.store(gameId, await this.enrich(result), false);
        }
      }
    }
    this.recordAttempt(gameId, `No confident match for "${clean.query}"`);
    return null;
  }

  /** Manual match by an admin; locks the result so automatic refreshes keep it. */
  async apply(gameId: string, providerName: string, providerId: string): Promise<GameMetadata> {
    const p = this.provider(providerName);
    if (!p) throw new Error(`Metadata provider "${providerName}" is not enabled`);
    const result = await p.fetch(providerId);
    if (!result) throw new Error(`${providerName} has no game ${providerId}`);
    return this.store(gameId, await this.enrich(result), true);
  }

  clear(gameId: string): void {
    this.db.prepare("DELETE FROM metadata WHERE game_id = ?").run(gameId);
    this.db.prepare("DELETE FROM metadata_attempts WHERE game_id = ?").run(gameId);
  }

  /** Fills controller support (Steam tags, then PCGamingWiki) and Steam age data the main provider lacked. */
  private async enrich(r: ProviderResult): Promise<ProviderResult> {
    r = await this.enrichDetails(r);
    // RAWG and Steam only have wide images; SteamGridDB has proper portrait covers.
    if (this.steamgriddb.enabled && (!r.coverUrl || r.provider !== "igdb")) {
      try {
        const id = await this.steamgriddb.gameId(r.name, r.steamAppId);
        const best = id ? (await this.steamgriddb.covers(id))[0] : undefined;
        if (best) r.coverUrl = best.url;
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, "SteamGridDB cover lookup failed");
      }
    }
    return r;
  }

  private async enrichDetails(r: ProviderResult): Promise<ProviderResult> {
    if (!r.steamAppId || r.provider === "steam") {
      if (r.controllerSupport === null && r.steamAppId) r.controllerSupport = await this.pcgw.controllerSupport(r.steamAppId).catch(() => null);
      return r;
    }
    try {
      const steam = await this.steam.fetch(r.steamAppId);
      if (steam) {
        r.controllerSupport ??= steam.controllerSupport;
        if (r.ageRatings.length === 0) r.ageRatings = steam.ageRatings;
        if (r.genres.length === 0) r.genres = steam.genres;
      }
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, "Steam enrichment failed");
    }
    if (r.controllerSupport === null) r.controllerSupport = await this.pcgw.controllerSupport(r.steamAppId).catch(() => null);
    return r;
  }

  private store(gameId: string, r: ProviderResult, locked: boolean): GameMetadata {
    const fetchedAt = now();
    this.db
      .prepare(
        `INSERT INTO metadata (game_id, provider, provider_id, name, summary, cover_url, screenshots, genres, themes, game_modes,
           release_date, rating, age_ratings, controller_support, steam_app_id, locked, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id) DO UPDATE SET provider = excluded.provider, provider_id = excluded.provider_id, name = excluded.name,
           summary = excluded.summary, cover_url = excluded.cover_url, screenshots = excluded.screenshots, genres = excluded.genres,
           themes = excluded.themes, game_modes = excluded.game_modes, release_date = excluded.release_date, rating = excluded.rating,
           age_ratings = excluded.age_ratings, controller_support = excluded.controller_support, steam_app_id = excluded.steam_app_id,
           locked = excluded.locked, fetched_at = excluded.fetched_at`,
      )
      .run(
        gameId,
        r.provider,
        r.providerId,
        r.name,
        r.summary,
        r.coverUrl,
        JSON.stringify(r.screenshots),
        JSON.stringify(r.genres),
        JSON.stringify(r.themes),
        JSON.stringify(r.gameModes),
        r.releaseDate,
        r.rating,
        JSON.stringify(r.ageRatings),
        r.controllerSupport,
        r.steamAppId,
        locked ? 1 : 0,
        fetchedAt,
      );
    this.db.prepare("DELETE FROM metadata_attempts WHERE game_id = ?").run(gameId);
    return { ...r, locked, fetchedAt };
  }

  /** Where an uploaded image for a game is kept. */
  uploadPath(gameId: string, kind: ArtworkKind): string {
    return path.join(this.dataDir, "artwork", `${gameId}-${kind}.img`);
  }

  /** Saves an uploaded image (admin) and points the game's override at it. */
  async saveUpload(gameId: string, kind: ArtworkKind, data: Buffer, contentType: string): Promise<void> {
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(contentType)) throw new Error("Upload a PNG, JPEG, WebP, GIF or AVIF image");
    if (data.length > 15 * 1024 * 1024) throw new Error("Images can be at most 15 MB");
    const file = this.uploadPath(gameId, kind);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, data);
    await rename(`${file}.tmp`, file);
    await writeFile(`${file}.type`, contentType);
    this.setOverride(gameId, kind, `upload:${Date.now()}`);
  }

  /** Sets (URL or upload marker) or clears (null) a game's cover/background override. */
  setOverride(gameId: string, kind: ArtworkKind, value: string | null): void {
    if (value && !value.startsWith("upload:") && !/^https?:\/\//.test(value)) throw new Error("Use an http(s) image URL");
    const col = kind === "cover" ? "cover_override" : "background_override";
    this.db.prepare(`UPDATE games SET ${col} = ? WHERE id = ?`).run(value, gameId);
  }

  /** Replacement artwork to pick from: SteamGridDB when a key is set, plus what the metadata already has. */
  async artworkOptions(gameId: string, kind: ArtworkKind, query?: string): Promise<ArtworkOption[]> {
    const game = this.library.get(gameId);
    if (!game) return [];
    const out: ArtworkOption[] = [];
    if (this.steamgriddb.enabled) {
      const id = query
        ? ((await this.steamgriddb.search(query))[0]?.id ?? null)
        : await this.steamgriddb.gameId(game.title, game.metadata?.steamAppId ?? null);
      if (id) out.push(...(kind === "cover" ? await this.steamgriddb.covers(id) : await this.steamgriddb.backgrounds(id)));
    }
    const m = game.metadata;
    if (m) {
      const own = kind === "cover" ? [m.coverUrl, m.steamAppId ? steamCover(m.steamAppId) : null] : [...m.screenshots, m.steamAppId ? steamHeader(m.steamAppId) : null];
      for (const url of own) if (url && !out.some((o) => o.url === url)) out.push({ url, thumb: url, width: 0, height: 0, source: m.provider });
    }
    return out.slice(0, 60);
  }

  /**
   * Local copy of a game's cover or background, downloaded on first request so the UI
   * keeps working if the image host is slow or gone. An admin override (upload or URL)
   * wins over metadata. Returns null when there is no image.
   */
  async imageFile(gameId: string, kind: ArtworkKind): Promise<{ file: string; contentType: string } | null> {
    const g = this.db.prepare("SELECT cover_override, background_override FROM games WHERE id = ?").get(gameId) as
      | { cover_override: string | null; background_override: string | null }
      | undefined;
    const override = kind === "cover" ? g?.cover_override : g?.background_override;
    if (override?.startsWith("upload:")) {
      const file = this.uploadPath(gameId, kind);
      const contentType = (await readFile(`${file}.type`, "utf8").catch(() => "image/jpeg")).trim();
      return (await stat(file).catch(() => null)) ? { file, contentType } : null;
    }
    const row = this.db.prepare("SELECT cover_url, screenshots, steam_app_id FROM metadata WHERE game_id = ?").get(gameId) as
      | { cover_url: string | null; screenshots: string; steam_app_id: string | null }
      | undefined;
    const urls: string[] = [];
    if (override) urls.push(override);
    else if (kind === "cover") {
      if (row?.cover_url) urls.push(row.cover_url);
      if (row?.steam_app_id) urls.push(steamHeader(row.steam_app_id));
    } else {
      const shots = JSON.parse(row?.screenshots ?? "[]") as string[];
      if (shots[0]) urls.push(shots[0]);
      if (row?.steam_app_id) urls.push(steamHeader(row.steam_app_id));
    }
    if (!urls.length) return null;
    const dir = path.join(this.dataDir, kind === "cover" ? "covers" : "backgrounds");
    const file = path.join(dir, `${gameId}-${Buffer.from(urls[0]!).toString("base64url").slice(-16)}.img`);
    try {
      await stat(file);
      return { file, contentType: (await readFile(`${file}.type`, "utf8").catch(() => "image/jpeg")).trim() };
    } catch {
      // not cached yet
    }
    for (const url of urls) {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (!res?.ok) continue;
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      if (!contentType.startsWith("image/")) continue;
      await mkdir(dir, { recursive: true });
      await writeFile(`${file}.tmp`, Buffer.from(await res.arrayBuffer()));
      await rename(`${file}.tmp`, file);
      await writeFile(`${file}.type`, contentType);
      return { file, contentType };
    }
    return null;
  }
}
