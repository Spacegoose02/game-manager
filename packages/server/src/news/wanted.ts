import type { Notifier } from "../alerts/notifier.js";
import type { DownloadManager } from "../connectors/manager.js";
import { now, type Db } from "../db/database.js";
import type { FoundRelease, WishItem, WishlistService } from "./wishlist.js";

const today = () => new Date().toISOString().slice(0, 10);

/** Out yet? Exact dates decide; "Q4 2026" style text means not yet; no date at all counts as out. */
export function isReleased(w: Pick<WishItem, "releaseDate" | "dateText">): boolean {
  if (w.releaseDate) return w.releaseDate <= today();
  return !w.dateText;
}

/**
 * The wanted list: monitored wishlist games that aren't in the library are searched through
 * Prowlarr on a schedule; the best release the rules allow is shown, and sent to the download
 * client when auto-grab is on. Also raises "it's out" alerts when a release date passes.
 */
export class WantedService {
  private running: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly wishlist: WishlistService,
    private readonly downloads: DownloadManager,
    private readonly notifier: Notifier,
  ) {}

  setMonitored(id: number, on: boolean): void {
    this.db.prepare("UPDATE wishlist SET monitored = ? WHERE id = ?").run(on ? 1 : 0, id);
  }

  /** Searches one game now; records (and announces) a new best match. */
  async search(id: number): Promise<FoundRelease | null> {
    const w = this.wishlist.list().find((x) => x.id === id);
    if (!w) throw new Error("Not on the wishlist");
    const results = await this.downloads.search(w.title, w.title);
    const best = results.find((r) => r.best);
    const found: FoundRelease | null = best ? { title: best.title, indexer: best.indexer, sizeBytes: best.sizeBytes, protocol: best.protocol, seeders: best.seeders, url: best.downloadUrl } : null;
    this.db.prepare("UPDATE wishlist SET searched_at = ?, found = ? WHERE id = ?").run(now(), found ? JSON.stringify(found) : null, id);
    if (found && found.url !== w.found?.url) {
      await this.notifier.send("found", `Found a release of ${w.title}`, `${found.title} (${found.indexer})`, "/wishlist");
      if (this.downloads.settings().wanted.autoGrab && !w.downloadId) await this.grab(id);
    }
    return found;
  }

  /** Sends the found release to the download client. */
  async grab(id: number): Promise<number> {
    const w = this.wishlist.list().find((x) => x.id === id);
    if (!w?.found) throw new Error("Search for it first");
    const d = await this.downloads.grab({ url: w.found.url, title: w.found.title, protocol: w.found.protocol }, null);
    this.db.prepare("UPDATE wishlist SET download_id = ? WHERE id = ?").run(d.id, id);
    return d.id;
  }

  /** "It's out" alerts: once per game, only for dates that pass while it's on the list. */
  async checkReleases(): Promise<void> {
    for (const w of this.wishlist.list()) {
      if (!w.releaseDate || w.releaseDate > today() || w.libraryId) continue;
      const row = this.db.prepare("SELECT released_notified FROM wishlist WHERE id = ?").get(w.id) as { released_notified: number };
      if (row.released_notified) continue;
      this.db.prepare("UPDATE wishlist SET released_notified = 1 WHERE id = ?").run(w.id);
      // Games that were already out when they were added don't need an alert.
      if (w.releaseDate >= w.addedAt.slice(0, 10)) await this.notifier.send("released", `${w.title} is out`, `Released ${w.releaseDate}`, "/wishlist");
    }
  }

  /** The scheduled pass: release alerts, then searches that are due. */
  run(): Promise<void> {
    this.running ??= (async () => {
      await this.checkReleases();
      const s = this.downloads.settings();
      if (!s.wanted.autoSearch || !this.downloads.prowlarr().configured) return;
      const due = Date.now() - s.wanted.intervalHours * 3600_000;
      for (const w of this.wishlist.list()) {
        if (!w.monitored || w.libraryId || w.downloadId) continue;
        if (s.wanted.onlyReleased && !isReleased(w)) continue;
        if (w.searchedAt && Date.parse(w.searchedAt) > due) continue;
        await this.search(w.id).catch(() => null);
        // Go easy on the indexers.
        await new Promise((r) => setTimeout(r, Number(process.env.GM_WANTED_DELAY_MS ?? 3000)));
      }
    })().finally(() => (this.running = null));
    return this.running;
  }
}
