import { cp, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Library } from "../catalog/library.js";
import { now, type Db } from "../db/database.js";
import type { FetchLike } from "../metadata/http.js";
import { ProwlarrClient, type SearchResult } from "./prowlarr.js";
import { QBittorrentClient } from "./qbittorrent.js";
import { SabnzbdClient } from "./sabnzbd.js";
import { loadConnectorSettings, type ConnectorSettings } from "./settings.js";
import type { ActiveDownload, DownloadClient } from "./types.js";

export interface DownloadRecord {
  id: number;
  client: ActiveDownload["client"];
  externalId: string | null;
  name: string;
  addedAt: string;
  status: "downloading" | "importing" | "imported" | "failed" | "removed";
  importedPath: string | null;
  importedAt: string | null;
  error: string | null;
  /** Live numbers from the client when it still has the download. */
  live: ActiveDownload | null;
}

interface Row {
  id: number;
  client: ActiveDownload["client"];
  external_id: string | null;
  name: string;
  added_at: string;
  status: DownloadRecord["status"];
  imported_path: string | null;
  imported_at: string | null;
  error: string | null;
}

/** Maps a client-side path (e.g. /data/torrents/games/X) to this container's view of it. */
export function mapPath(p: string, mappings: ConnectorSettings["import"]["pathMappings"]): string {
  const norm = p.replace(/\\/g, "/");
  const hit = [...mappings].sort((a, b) => b.from.length - a.from.length).find((m) => norm === m.from || norm.startsWith(m.from.replace(/\/$/, "") + "/"));
  return hit ? path.posix.join(hit.to, norm.slice(hit.from.replace(/\/$/, "").length)) : norm;
}

const sanitize = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "") || "download";

/**
 * Sends Prowlarr results to qBittorrent or SABnzbd, follows them, and copies or
 * moves finished downloads into the games folder so they appear in the library.
 */
export class DownloadManager {
  private reconciling: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly library: Library,
    private readonly log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  settings(): ConnectorSettings {
    return loadConnectorSettings(this.db);
  }

  clients(): DownloadClient[] {
    const s = this.settings();
    return [new QBittorrentClient(s.qbittorrent, this.fetchImpl), new SabnzbdClient(s.sabnzbd, this.fetchImpl)];
  }

  client(name: string): DownloadClient {
    const c = this.clients().find((x) => x.name === name);
    if (!c?.configured) throw new Error(`${name} is not set up`);
    return c;
  }

  prowlarr(): ProwlarrClient {
    return new ProwlarrClient(this.settings().prowlarr, this.fetchImpl);
  }

  async test(which: "qbittorrent" | "sabnzbd" | "prowlarr"): Promise<string> {
    return which === "prowlarr" ? this.prowlarr().test() : this.client(which).test();
  }

  async search(query: string): Promise<SearchResult[]> {
    const p = this.prowlarr();
    if (!p.configured) throw new Error("Prowlarr is not set up");
    return p.search(query);
  }

  /** Sends a link (magnet, .torrent or .nzb URL) to the matching client and starts tracking it. */
  async grab(input: { url: string; title: string; protocol: "torrent" | "usenet" }, userId: number | null): Promise<DownloadRecord> {
    const clientName = input.protocol === "usenet" ? "sabnzbd" : "qbittorrent";
    const client = this.client(clientName);
    const result = this.db
      .prepare("INSERT INTO downloads (client, name, source_url, added_by, added_at) VALUES (?, ?, ?, ?, ?)")
      .run(clientName, input.title, input.url, userId, now());
    const id = Number(result.lastInsertRowid);
    try {
      const external = client instanceof QBittorrentClient ? await client.add(input.url, input.title, `gm-${id}`) : await client.add(input.url, input.title);
      this.db.prepare("UPDATE downloads SET external_id = ? WHERE id = ?").run(external, id);
    } catch (err) {
      this.db.prepare("UPDATE downloads SET status = 'failed', error = ? WHERE id = ?").run((err as Error).message, id);
      throw err;
    }
    return this.get(id)!;
  }

  private rows(): Row[] {
    return this.db.prepare("SELECT * FROM downloads WHERE status != 'removed' ORDER BY id DESC LIMIT 200").all() as unknown as Row[];
  }

  get(id: number): DownloadRecord | undefined {
    const r = this.db.prepare("SELECT * FROM downloads WHERE id = ?").get(id) as Row | undefined;
    return r && this.toRecord(r, null);
  }

  private toRecord(r: Row, live: ActiveDownload | null): DownloadRecord {
    return {
      id: r.id,
      client: r.client,
      externalId: r.external_id,
      name: r.name,
      addedAt: r.added_at,
      status: r.status,
      importedPath: r.imported_path,
      importedAt: r.imported_at,
      error: r.error,
      live,
    };
  }

  /** Finds the client's entry for one of our rows: SABnzbd by nzo id, qBittorrent by our tag. */
  private match(r: Row, live: Array<ActiveDownload & { tags?: string }>): ActiveDownload | null {
    if (!r.external_id) return null;
    return (
      live.find((d) => d.client === r.client && (d.id === r.external_id || (d.tags ?? "").split(/,\s*/).includes(r.external_id!))) ?? null
    );
  }

  private async liveAll(): Promise<ActiveDownload[]> {
    const out: ActiveDownload[] = [];
    for (const c of this.clients().filter((x) => x.configured)) {
      try {
        out.push(...(await c.list()));
      } catch (err) {
        this.log.warn({ client: c.name, err: (err as Error).message }, "Could not read download client");
      }
    }
    return out;
  }

  /** Our downloads with live progress, plus anything else in the clients' game category. */
  async list(): Promise<{ downloads: DownloadRecord[]; other: ActiveDownload[] }> {
    const live = await this.liveAll();
    const used = new Set<ActiveDownload>();
    const downloads = this.rows().map((r) => {
      const l = this.match(r, live);
      if (l) used.add(l);
      return this.toRecord(r, l);
    });
    return { downloads, other: live.filter((l) => !used.has(l)) };
  }

  async control(id: number, action: "pause" | "resume" | "remove", deleteFiles = false): Promise<void> {
    const r = this.db.prepare("SELECT * FROM downloads WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new Error("No such download");
    const live = this.match(r, await this.liveAll());
    const client = this.client(r.client);
    if (action === "remove") {
      if (live) await client.remove(live.id, deleteFiles);
      this.db.prepare("UPDATE downloads SET status = 'removed' WHERE id = ?").run(id);
      return;
    }
    if (!live) throw new Error("The download client no longer has this download");
    await (action === "pause" ? client.pause(live.id) : client.resume(live.id));
  }

  /** Imports finished downloads. Runs on a timer and after each list in the UI. */
  reconcile(): Promise<void> {
    this.reconciling ??= this.doReconcile().finally(() => (this.reconciling = null));
    return this.reconciling;
  }

  private async doReconcile(): Promise<void> {
    const pending = this.rows().filter((r) => r.status === "downloading");
    if (!pending.length) return;
    const live = await this.liveAll();
    const settings = this.settings();
    let imported = false;
    for (const r of pending) {
      const l = this.match(r, live);
      if (!l) continue;
      if (l.state === "failed") {
        this.db.prepare("UPDATE downloads SET status = 'failed', error = ? WHERE id = ?").run("The download client reported a failure", r.id);
        continue;
      }
      const finished = l.progress >= 1 && (l.state === "completed" || l.state === "seeding");
      if (!finished || settings.import.mode === "off" || !l.path) continue;
      try {
        this.db.prepare("UPDATE downloads SET status = 'importing' WHERE id = ?").run(r.id);
        const target = await this.importPath(mapPath(l.path, settings.import.pathMappings), settings.import.mode);
        this.db.prepare("UPDATE downloads SET status = 'imported', imported_path = ?, imported_at = ?, error = NULL WHERE id = ?").run(target, now(), r.id);
        this.log.info({ name: r.name, target }, "Imported download into the library");
        imported = true;
      } catch (err) {
        const msg = (err as NodeJS.ErrnoException).code === "EROFS" || (err as NodeJS.ErrnoException).code === "EACCES"
          ? "The games folder is read-only; mount it read-write to import downloads"
          : (err as Error).message;
        this.db.prepare("UPDATE downloads SET status = 'downloading', error = ? WHERE id = ?").run(msg, r.id);
        this.log.warn({ name: r.name, err: msg }, "Import failed");
      }
    }
    if (imported) await this.library.rescan();
  }

  private async importPath(source: string, mode: "copy" | "move"): Promise<string> {
    const s = await stat(source).catch(() => null);
    if (!s) throw new Error(`Finished download not found at ${source}; check the path mappings`);
    const target = path.join(this.library.gamesDir, sanitize(path.basename(source)));
    if (await stat(target).catch(() => null)) throw new Error(`${path.basename(target)} already exists in the games folder`);
    if (mode === "move") {
      try {
        await rename(source, target);
        return target;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      }
    }
    // Copy into a temporary name first so a half-copied game never shows up in the library.
    const temp = `${target}.importing`;
    await cp(source, temp, { recursive: true, errorOnExist: true });
    await rename(temp, target);
    if (mode === "move") await rm(source, { recursive: true, force: true });
    return target;
  }
}
