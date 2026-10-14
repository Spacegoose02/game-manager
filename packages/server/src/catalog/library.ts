import { createHash } from "node:crypto";
import { mkdir, rename, statfs } from "node:fs/promises";
import path from "node:path";
import { compareVersion, PC_PLATFORM, PLATFORMS, type ControllerSupport, type GameDetail, type GameMetadata, type GameSummary, type LibraryStats, type PackageKind } from "@lootden/shared";
import { json, now, type Db } from "../db/database.js";
import { kidSafeFromRatings } from "../metadata/ratings.js";
import { cleanTitle, titleSimilarity } from "../metadata/titles.js";
import { gameIdFor, scanLibrary, type ScannedGame } from "./scanner.js";

export interface GameQuery {
  search?: string;
  genre?: string;
  controller?: "full" | "partial" | "any";
  kidSafe?: boolean;
  /** Only games no metadata provider has matched yet (admin clean-up list). */
  missingMetadata?: boolean;
  /** "pc", "emulated" (every other system) or one platform id. Unset means everything. */
  platform?: string;
  /** "game" (the default) leaves update and DLC packages out; "addon" is updates and DLC together. */
  kind?: PackageKind | "addon" | "all";
  sort?: "title" | "added" | "release" | "rating" | "size";
  order?: "asc" | "desc";
  limit?: number;
}

interface GameRow {
  id: string;
  added_at: string;
  title_override: string | null;
  kid_safe_override: number | null;
  controller_override: string | null;
  cover_override: string | null;
  background_override: string | null;
  save_path: string | null;
  kind_override: string | null;
  base_game_override: string | null;
}

interface MetadataRow {
  game_id: string;
  provider: string;
  provider_id: string;
  name: string;
  summary: string | null;
  cover_url: string | null;
  screenshots: string;
  genres: string;
  themes: string;
  game_modes: string;
  release_date: string | null;
  rating: number | null;
  age_ratings: string;
  controller_support: string | null;
  steam_app_id: string | null;
  locked: number;
  fetched_at: string;
}

export function metadataFromRow(row: MetadataRow): GameMetadata {
  return {
    provider: row.provider,
    providerId: row.provider_id,
    name: row.name,
    summary: row.summary,
    coverUrl: row.cover_url,
    screenshots: json(row.screenshots, []),
    genres: json(row.genres, []),
    themes: json(row.themes, []),
    gameModes: json(row.game_modes, []),
    releaseDate: row.release_date,
    rating: row.rating,
    ageRatings: json(row.age_ratings, []),
    controllerSupport: (row.controller_support as ControllerSupport | null) ?? null,
    steamAppId: row.steam_app_id,
    locked: row.locked === 1,
    fetchedAt: row.fetched_at,
  };
}

/**
 * The catalog. File lists come from scanning the games folder (the source of truth);
 * the database adds first-seen dates, admin overrides and metadata.
 */
export class Library {
  private scanned = new Map<string, ScannedGame>();
  private lastScanAt: Date | null = null;
  private lastScanMs: number | null = null;
  private scanning: Promise<void> | null = null;
  private listeners: Array<(games: ScannedGame[]) => void> = [];
  /** Which game each update or DLC belongs to; rebuilt after scans, overrides and metadata changes (and at most every few seconds). */
  private baseCache: { at: number; map: Map<string, string | null> } | null = null;

  constructor(
    private readonly db: Db,
    readonly gamesDir: string,
  ) {}

  /** Called after every scan; the metadata service uses it to pick up new games. */
  onScanned(listener: (games: ScannedGame[]) => void): void {
    this.listeners.push(listener);
  }

  /** Runs a scan, or joins the one already running. */
  rescan(): Promise<void> {
    this.scanning ??= (async () => {
      const started = Date.now();
      try {
        const games = await scanLibrary(this.gamesDir);
        this.sync(games);
        this.scanned = new Map(games.map((g) => [g.id, g]));
        this.baseCache = null;
        this.lastScanAt = new Date();
        this.lastScanMs = Date.now() - started;
      } finally {
        this.scanning = null;
      }
      const games = [...this.scanned.values()];
      for (const l of this.listeners) l(games);
    })();
    return this.scanning;
  }

  private sync(games: ScannedGame[]): void {
    const ts = now();
    const insert = this.db.prepare(
      "INSERT INTO games (id, source, added_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET removed_at = NULL",
    );
    this.db.exec("BEGIN");
    try {
      for (const g of games) insert.run(g.id, g.source, ts);
      const present = new Set(games.map((g) => g.id));
      const known = this.db.prepare("SELECT id FROM games WHERE removed_at IS NULL").all() as Array<{ id: string }>;
      const markRemoved = this.db.prepare("UPDATE games SET removed_at = ? WHERE id = ?");
      for (const { id } of known) if (!present.has(id)) markRemoved.run(ts, id);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  scannedGame(id: string): ScannedGame | undefined {
    return this.scanned.get(id);
  }

  allScanned(): ScannedGame[] {
    return [...this.scanned.values()];
  }

  private rows(): { games: Map<string, GameRow>; meta: Map<string, MetadataRow> } {
    const games = new Map(
      (this.db.prepare("SELECT id, added_at, title_override, kid_safe_override, controller_override, cover_override, background_override, save_path, kind_override, base_game_override FROM games").all() as unknown as GameRow[]).map(
        (r) => [r.id, r],
      ),
    );
    const meta = new Map((this.db.prepare("SELECT * FROM metadata").all() as unknown as MetadataRow[]).map((r) => [r.game_id, r]));
    return { games, meta };
  }

  /** What an entry is: the admin's correction, else what its name says. */
  private kindOf(g: ScannedGame, row: Pick<GameRow, "kind_override"> | undefined): PackageKind {
    const k = row?.kind_override;
    return k === "game" || k === "update" || k === "dlc" ? k : g.kind;
  }

  /**
   * Matches every update and DLC to its game: the admin's choice, else the library game whose
   * name best matches the package's ("Cyberpunk 2077 Update v2.1" belongs to "Cyberpunk 2077").
   */
  private bases(): Map<string, string | null> {
    if (this.baseCache && Date.now() - this.baseCache.at < 5000) return this.baseCache.map;
    const { games: rows, meta } = this.rows();
    const all = [...this.scanned.values()];
    const games = all.filter((g) => this.kindOf(g, rows.get(g.id)) === "game");
    const names = new Map(
      games.map((g) => {
        const row = rows.get(g.id);
        const shown = [row?.title_override, meta.get(g.id)?.name, g.title].filter((x): x is string => !!x);
        return [g.id, [...shown, cleanTitle(path.posix.basename(g.source)).query]];
      }),
    );
    const map = new Map<string, string | null>();
    for (const p of all) {
      const row = rows.get(p.id);
      if (this.kindOf(p, row) === "game") continue;
      const chosen = row?.base_game_override;
      if (chosen) {
        map.set(p.id, chosen !== "none" && this.scanned.has(chosen) ? chosen : null);
        continue;
      }
      const want = cleanTitle(p.baseTitle).query;
      let best: { id: string; score: number } | null = null;
      for (const g of games) {
        if (g.platform !== p.platform) continue;
        const score = Math.max(...names.get(g.id)!.map((n) => titleSimilarity(want, n)));
        if (score >= 0.8 && (!best || score > best.score)) best = { id: g.id, score };
      }
      map.set(p.id, best?.id ?? null);
    }
    this.baseCache = { at: Date.now(), map };
    return map;
  }

  private view(g: ScannedGame, row: GameRow | undefined, metaRow: MetadataRow | undefined): GameDetail {
    const metadata = metaRow ? metadataFromRow(metaRow) : null;
    const kind = this.kindOf(g, row);
    const baseGameId = kind === "game" ? null : (this.bases().get(g.id) ?? null);
    const baseGame = baseGameId ? this.get(baseGameId, false) : undefined;
    const ownCover = imageUrl(g.id, "cover", row?.cover_override ?? metadata?.coverUrl ?? (metadata?.steamAppId ? "steam" : null) ?? metadata?.screenshots[0] ?? null);
    const ownKidSafe =
      row?.kid_safe_override != null ? row.kid_safe_override === 1 : metadata ? kidSafeFromRatings(metadata.ageRatings) : null;
    const { files, entryModifiedAt, ...base } = g;
    return {
      ...base,
      title: row?.title_override || metadata?.name || g.title,
      // "Recently added" follows the folder's Date modified, like sorting the games folder in Explorer.
      addedAt: entryModifiedAt ?? row?.added_at ?? new Date(0).toISOString(),
      // Updates and DLC show their game's art unless they have their own.
      coverUrl: ownCover ?? baseGame?.coverUrl ?? null,
      backgroundUrl: imageUrl(g.id, "background", row?.background_override ?? metadata?.screenshots[0] ?? (metadata?.steamAppId ? "steam" : null)),
      genres: metadata?.genres ?? [],
      releaseYear: metadata?.releaseDate ? Number(metadata.releaseDate.slice(0, 4)) : null,
      rating: metadata?.rating != null ? Math.round(metadata.rating) : null,
      controllerSupport: (row?.controller_override as ControllerSupport | null) ?? metadata?.controllerSupport ?? null,
      // Updates and DLC are as kid-safe as their game.
      kidSafe: ownKidSafe ?? baseGame?.kidSafe ?? null,
      kind,
      version: g.version,
      fromVersion: kind === "update" ? g.fromVersion : null,
      baseGameId,
      files,
      metadata,
      overrides: {
        title: row?.title_override ?? null,
        kidSafe: row?.kid_safe_override == null ? null : row.kid_safe_override === 1,
        controllerSupport: (row?.controller_override as ControllerSupport | null) ?? null,
        cover: row?.cover_override ?? null,
        background: row?.background_override ?? null,
      },
      savePath: row?.save_path ?? null,
      addons: [],
      baseGame: null,
      packageOverrides: {
        kind: (row?.kind_override as PackageKind | null) ?? null,
        baseGameId: row?.base_game_override ?? null,
      },
    };
  }

  /** One game with its file list. `related` adds its updates and DLC, or the game an update belongs to. */
  get(id: string, related = true): GameDetail | undefined {
    const g = this.scanned.get(id);
    if (!g) return undefined;
    const row = this.db.prepare("SELECT id, added_at, title_override, kid_safe_override, controller_override, cover_override, background_override, save_path, kind_override, base_game_override FROM games WHERE id = ?").get(id) as
      | GameRow
      | undefined;
    const meta = this.db.prepare("SELECT * FROM metadata WHERE game_id = ?").get(id) as MetadataRow | undefined;
    const game = this.view(g, row, meta);
    if (!related) return game;
    if (game.kind === "game") {
      game.addons = this.list({ kind: "addon" })
        .filter((a) => a.baseGameId === id)
        .sort((a, b) => (a.kind === b.kind ? (b.version && a.version ? compareVersion(b.version, a.version) : 0) : a.kind === "update" ? -1 : 1));
    } else if (game.baseGameId) {
      const base = this.get(game.baseGameId, false);
      if (base) game.baseGame = { id: base.id, title: base.title, coverUrl: base.coverUrl, version: base.version };
    }
    return game;
  }

  /** Admin: corrects what an entry is and which game it belongs to (null = work it out from the name, "none" = no game). */
  setPackage(id: string, o: { kind?: PackageKind | null; baseGameId?: string | null }): void {
    if (o.kind !== undefined) this.db.prepare("UPDATE games SET kind_override = ? WHERE id = ?").run(o.kind, id);
    if (o.baseGameId !== undefined) {
      if (o.baseGameId && o.baseGameId !== "none" && !this.scanned.has(o.baseGameId)) throw new Error("Unknown game");
      if (o.baseGameId === id) throw new Error("An update can't belong to itself");
      this.db.prepare("UPDATE games SET base_game_override = ? WHERE id = ?").run(o.baseGameId, id);
    }
    this.baseCache = null;
  }

  list(query: GameQuery = {}): GameSummary[] {
    const { games, meta } = this.rows();
    const q = query.search?.trim().toLowerCase();
    const genre = query.genre?.toLowerCase();
    let out: GameSummary[] = [];
    for (const g of this.scanned.values()) {
      const kind = this.kindOf(g, games.get(g.id));
      const want = query.kind ?? "game";
      if (want !== "all" && (want === "addon" ? kind === "game" : kind !== want)) continue;
      const { files: _f, metadata: _m, overrides: _o, backgroundUrl: _b, savePath: _s, addons: _a, baseGame: _g, packageOverrides: _p, ...summary } = this.view(g, games.get(g.id), meta.get(g.id));
      if (q && !summary.title.toLowerCase().includes(q) && !summary.source.toLowerCase().includes(q)) continue;
      if (query.platform === "emulated" ? summary.platform === PC_PLATFORM : query.platform && summary.platform !== query.platform) continue;
      if (genre && !summary.genres.some((x) => x.toLowerCase() === genre)) continue;
      if (query.kidSafe && summary.kidSafe !== true) continue;
      if (query.missingMetadata && meta.has(g.id)) continue;
      if (query.controller === "full" && summary.controllerSupport !== "full") continue;
      if (query.controller === "partial" && summary.controllerSupport !== "partial" && summary.controllerSupport !== "full") continue;
      if (query.controller === "any" && summary.controllerSupport !== "partial" && summary.controllerSupport !== "full") continue;
      out.push(summary);
    }
    const dir = query.order === "desc" ? -1 : 1;
    const by = query.sort ?? "title";
    const key = (s: GameSummary): string | number =>
      by === "added" ? s.addedAt : by === "release" ? (s.releaseYear ?? 0) : by === "rating" ? (s.rating ?? -1) : by === "size" ? s.sizeBytes : s.title.toLowerCase();
    out.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const c = typeof ka === "number" ? ka - (kb as number) : ka.localeCompare(kb as string);
      return c * dir || a.title.localeCompare(b.title);
    });
    if (query.limit) out = out.slice(0, query.limit);
    return out;
  }

  /** Systems in the library with game counts, PC first, for the Emulation section. */
  platforms(kidSafeOnly = false): Array<{ id: string; count: number; sizeBytes: number }> {
    const counts = new Map<string, { id: string; count: number; sizeBytes: number }>();
    for (const g of this.list({ kidSafe: kidSafeOnly })) {
      const c = counts.get(g.platform) ?? { id: g.platform, count: 0, sizeBytes: 0 };
      c.count++;
      c.sizeBytes += g.sizeBytes;
      counts.set(g.platform, c);
    }
    const order = (id: string) => (id === PC_PLATFORM ? -1 : PLATFORMS.findIndex((x) => x.id === id) >>> 0);
    return [...counts.values()].sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id));
  }

  /** Distinct genres with counts, for filter menus. */
  genres(kidSafeOnly = false, platform?: string): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    for (const g of this.list({ kidSafe: kidSafeOnly, platform })) for (const name of g.genres) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  /**
   * Swaps a game for a new copy (the zipped install made from a disc image or installer).
   * The new file is already in the games folder; the old one moves to .replaced/ and its
   * metadata, overrides, play history and saves carry over to the new id.
   */
  async replaceGame(oldId: string, newSource: string): Promise<GameDetail> {
    const old = this.scanned.get(oldId);
    if (!old) throw new Error("Unknown game");
    const newId = gameIdFor(newSource);
    const replaced = path.join(this.gamesDir, ".replaced");
    await mkdir(replaced, { recursive: true });
    await rename(path.join(this.gamesDir, old.source), path.join(replaced, `${Date.now()}-${old.source}`));
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO games (id, source, added_at, title_override, kid_safe_override, controller_override, cover_override, background_override, save_path, kind_override, base_game_override)
           SELECT ?, ?, added_at, title_override, kid_safe_override, controller_override, cover_override, background_override, save_path, kind_override, base_game_override FROM games WHERE id = ?
           ON CONFLICT(id) DO NOTHING`,
        )
        .run(newId, newSource, oldId);
      for (const table of ["metadata", "metadata_attempts", "user_games", "saves"]) {
        this.db.prepare(`UPDATE OR IGNORE ${table} SET game_id = ? WHERE game_id = ?`).run(newId, oldId);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    await this.rescan();
    const game = this.get(newId);
    if (!game) throw new Error(`${newSource} didn't show up in the library after the upload`);
    return game;
  }

  setSavePath(id: string, savePath: string | null): void {
    this.db.prepare("UPDATE games SET save_path = ? WHERE id = ?").run(savePath || null, id);
  }

  setOverrides(id: string, o: { title?: string | null; kidSafe?: boolean | null; controller?: ControllerSupport | null }): void {
    if (o.title !== undefined) this.db.prepare("UPDATE games SET title_override = ? WHERE id = ?").run(o.title || null, id);
    if (o.kidSafe !== undefined) this.db.prepare("UPDATE games SET kid_safe_override = ? WHERE id = ?").run(o.kidSafe === null ? null : o.kidSafe ? 1 : 0, id);
    if (o.controller !== undefined) this.db.prepare("UPDATE games SET controller_override = ? WHERE id = ?").run(o.controller, id);
  }

  async stats(): Promise<LibraryStats> {
    let disk: LibraryStats["disk"] = null;
    try {
      const s = await statfs(this.gamesDir);
      disk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
    } catch {
      disk = null;
    }
    let totalBytes = 0;
    for (const g of this.scanned.values()) totalBytes += g.sizeBytes;
    return {
      gameCount: this.scanned.size,
      totalBytes,
      lastScanAt: this.lastScanAt?.toISOString() ?? null,
      lastScanMs: this.lastScanMs,
      disk,
    };
  }
}

/** Server URL of a game image; the version changes whenever the source does, so browsers refetch. */
function imageUrl(id: string, kind: "cover" | "background", source: string | null): string | null {
  if (!source) return null;
  const v = createHash("sha1").update(source).digest("hex").slice(0, 8);
  return `/api/games/${id}/${kind}?v=${v}`;
}
