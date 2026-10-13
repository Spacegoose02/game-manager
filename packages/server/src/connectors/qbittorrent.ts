import type { FetchLike } from "../metadata/http.js";
import type { ConnectorSettings } from "./settings.js";
import { waitForTorrent, type TorrentPayload } from "./torrent.js";
import { verifyDelay, type ActiveDownload, type TorrentClient } from "./types.js";

interface QbTorrent {
  hash: string;
  name: string;
  size: number;
  total_size?: number;
  progress: number;
  dlspeed: number;
  eta: number;
  state: string;
  category: string;
  tags: string;
  content_path?: string;
  save_path?: string;
}

const STATE: Record<string, ActiveDownload["state"]> = {
  downloading: "downloading",
  metaDL: "downloading",
  forcedDL: "downloading",
  stalledDL: "downloading",
  forcedMetaDL: "downloading",
  pausedDL: "paused",
  stoppedDL: "paused",
  queuedDL: "queued",
  queuedUP: "seeding",
  uploading: "seeding",
  stalledUP: "seeding",
  forcedUP: "seeding",
  pausedUP: "completed",
  stoppedUP: "completed",
  checkingDL: "checking",
  checkingUP: "checking",
  checkingResumeData: "checking",
  moving: "checking",
  error: "failed",
  missingFiles: "failed",
};

/** qBittorrent Web API v2 (qBittorrent 4.1+ and 5.x). */
export class QBittorrentClient implements TorrentClient {
  readonly name = "qbittorrent" as const;
  private sid: string | null = null;

  constructor(
    private readonly s: ConnectorSettings["qbittorrent"],
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get configured(): boolean {
    return !!this.s.url;
  }

  private async login(): Promise<void> {
    const res = await this.fetchImpl(`${this.s.url}/api/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: this.s.url, Origin: this.s.url },
      body: new URLSearchParams({ username: this.s.username, password: this.s.password }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok || text.trim() === "Fails.") throw new Error("qBittorrent rejected the username or password");
    const cookie = res.headers.get("set-cookie")?.match(/SID=([^;]+)/);
    // With "bypass authentication for localhost/whitelisted subnets" there may be no cookie, which is fine.
    this.sid = cookie?.[1] ?? "";
  }

  private async call(path: string, form?: Record<string, string> | FormData, retried = false): Promise<Response> {
    if (this.sid === null) await this.login();
    const multipart = form instanceof FormData;
    const res = await this.fetchImpl(`${this.s.url}/api/v2/${path}`, {
      method: form ? "POST" : "GET",
      headers: {
        Referer: this.s.url,
        ...(this.sid ? { Cookie: `SID=${this.sid}` } : {}),
        ...(form && !multipart ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? (multipart ? form : new URLSearchParams(form)) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 403 && !retried) {
      this.sid = null;
      return this.call(path, form, true);
    }
    return res;
  }

  async test(): Promise<string> {
    const res = await this.call("app/version");
    if (!res.ok) throw new Error(`qBittorrent answered ${res.status}`);
    return `qBittorrent ${await res.text()}`;
  }

  /** Adds a magnet or .torrent URL as is (no checks). Prefer addTorrent. */
  async add(url: string, _name?: string, tag = `gm-${Date.now()}`): Promise<string> {
    const form: Record<string, string> = { urls: url, category: this.s.category, tags: tag };
    if (this.s.savePath) form.savepath = this.s.savePath;
    const res = await this.call("torrents/add", form);
    const text = await res.text();
    if (!res.ok || /fails/i.test(text)) throw new Error(`qBittorrent did not accept the torrent (${res.status} ${text.trim()})`);
    return tag;
  }

  private async has(hash: string): Promise<boolean> {
    const res = await this.call(`torrents/info?hashes=${hash}`);
    return res.ok && ((await res.json()) as QbTorrent[]).some((t) => t.hash.toLowerCase() === hash);
  }

  /**
   * Adds a magnet or a .torrent file, then checks qBittorrent really has it: qBittorrent answers
   * "Ok." even when it later drops a torrent it can't fetch. Returns the info hash.
   */
  async addTorrent(payload: TorrentPayload, tag: string): Promise<string> {
    // Adding into a category that doesn't exist yet fails on some versions.
    if (this.s.category) await this.call("torrents/createCategory", { category: this.s.category, savePath: this.s.savePath ?? "" }).catch(() => null);
    const hash = payload.hash;
    if (hash && (await this.has(hash).catch(() => false))) {
      // Already in qBittorrent (added by hand, or an earlier try): take it over instead of failing.
      await this.call("torrents/addTags", { hashes: hash, tags: tag }).catch(() => null);
      if (this.s.category) await this.call("torrents/setCategory", { hashes: hash, category: this.s.category }).catch(() => null);
      return hash;
    }
    const form = new FormData();
    if ("magnet" in payload) form.append("urls", payload.magnet);
    else form.append("torrents", new Blob([Buffer.from(payload.file)], { type: "application/x-bittorrent" }), payload.name);
    if (this.s.category) form.append("category", this.s.category);
    form.append("tags", tag);
    if (this.s.savePath) form.append("savepath", this.s.savePath);
    const res = await this.call("torrents/add", form);
    const text = (await res.text()).trim();
    if (res.status === 415) throw new Error("qBittorrent says the torrent file is invalid");
    if (!res.ok || /^fails/i.test(text)) throw new Error(`qBittorrent refused the torrent (${res.status}${text ? ` ${text}` : ""})`);
    if (!hash) return tag;
    if (!(await waitForTorrent(() => this.has(hash), 10, verifyDelay()))) {
      throw new Error("qBittorrent said OK but never added the torrent. Check qBittorrent's log; the magnet may have no peers or the download folder may not be writable.");
    }
    return hash;
  }

  async list(): Promise<ActiveDownload[]> {
    const res = await this.call(`torrents/info?category=${encodeURIComponent(this.s.category)}`);
    if (!res.ok) throw new Error(`qBittorrent answered ${res.status}`);
    return ((await res.json()) as QbTorrent[]).map((t) => ({
      client: this.name,
      id: t.hash,
      name: t.name,
      sizeBytes: t.total_size ?? t.size,
      progress: t.progress,
      downloadSpeed: t.dlspeed,
      etaSeconds: t.eta >= 8640000 ? null : t.eta,
      state: STATE[t.state] ?? "downloading",
      path: t.content_path ?? (t.save_path ? `${t.save_path.replace(/\/$/, "")}/${t.name}` : null),
      tags: t.tags,
    })) as Array<ActiveDownload & { tags: string }>;
  }

  /** qBittorrent 5 renamed pause/resume to stop/start; try the new name first. */
  private async either(newPath: string, oldPath: string, form: Record<string, string>): Promise<void> {
    const res = await this.call(newPath, form);
    if (res.status === 404) {
      const old = await this.call(oldPath, form);
      if (!old.ok) throw new Error(`qBittorrent answered ${old.status}`);
    } else if (!res.ok) throw new Error(`qBittorrent answered ${res.status}`);
  }

  pause(id: string) {
    return this.either("torrents/stop", "torrents/pause", { hashes: id });
  }

  resume(id: string) {
    return this.either("torrents/start", "torrents/resume", { hashes: id });
  }

  async remove(id: string, deleteFiles: boolean): Promise<void> {
    const res = await this.call("torrents/delete", { hashes: id, deleteFiles: String(deleteFiles) });
    if (!res.ok) throw new Error(`qBittorrent answered ${res.status}`);
  }
}
