import type { FetchLike } from "../metadata/http.js";
import type { ConnectorSettings } from "./settings.js";
import { waitForTorrent, type TorrentPayload } from "./torrent.js";
import { verifyDelay, type ActiveDownload, type TorrentClient } from "./types.js";

interface TrTorrent {
  hashString: string;
  name: string;
  totalSize: number;
  percentDone: number;
  rateDownload: number;
  eta: number;
  status: number;
  error: number;
  downloadDir: string;
  labels?: string[];
}

// 0 stopped, 1 queued to check, 2 checking, 3 queued to download, 4 downloading, 5 queued to seed, 6 seeding.
const STATE: Record<number, ActiveDownload["state"]> = { 0: "paused", 1: "checking", 2: "checking", 3: "queued", 4: "downloading", 5: "seeding", 6: "seeding" };

/** Transmission's RPC (Transmission 3 and 4). Torrents are labelled with the category and LootDen's tag. */
export class TransmissionClient implements TorrentClient {
  readonly name = "transmission" as const;
  private session = "";

  constructor(
    private readonly s: ConnectorSettings["transmission"],
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get configured(): boolean {
    return !!this.s.url;
  }

  private endpoint(): string {
    return /\/rpc$/.test(this.s.url) ? this.s.url : `${this.s.url}/transmission/rpc`;
  }

  private async rpc<T>(method: string, args: object = {}, retried = false): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-Transmission-Session-Id": this.session };
    if (this.s.username || this.s.password) headers.Authorization = `Basic ${Buffer.from(`${this.s.username}:${this.s.password}`).toString("base64")}`;
    const res = await this.fetchImpl(this.endpoint(), { method: "POST", headers, body: JSON.stringify({ method, arguments: args }), signal: AbortSignal.timeout(15_000) });
    // Transmission's CSRF guard: the first call gets a 409 with the session id to use.
    if (res.status === 409 && !retried) {
      this.session = res.headers.get("x-transmission-session-id") ?? "";
      return this.rpc(method, args, true);
    }
    if (res.status === 401) throw new Error("Transmission rejected the username or password");
    if (!res.ok) throw new Error(`Transmission answered ${res.status}`);
    const body = (await res.json()) as { result: string; arguments: T };
    if (body.result !== "success") throw new Error(`Transmission: ${body.result}`);
    return body.arguments;
  }

  async test(): Promise<string> {
    const r = await this.rpc<{ version: string }>("session-get", { fields: ["version"] });
    return `Transmission ${r.version}`;
  }

  add(url: string): Promise<string | null> {
    return this.addTorrent({ magnet: url, hash: null }, `gm-${Date.now()}`);
  }

  private async get(ids?: string[]): Promise<TrTorrent[]> {
    const r = await this.rpc<{ torrents: TrTorrent[] }>("torrent-get", {
      ...(ids ? { ids } : {}),
      fields: ["hashString", "name", "totalSize", "percentDone", "rateDownload", "eta", "status", "error", "downloadDir", "labels"],
    });
    return r.torrents;
  }

  async addTorrent(payload: TorrentPayload, tag: string): Promise<string> {
    const args: Record<string, unknown> = "magnet" in payload ? { filename: payload.magnet } : { metainfo: Buffer.from(payload.file).toString("base64") };
    if (this.s.savePath) args["download-dir"] = this.s.savePath;
    args.labels = [this.s.category, tag].filter(Boolean);
    const r = await this.rpc<{ "torrent-added"?: { hashString: string }; "torrent-duplicate"?: { hashString: string } }>("torrent-add", args);
    const hash = (r["torrent-added"] ?? r["torrent-duplicate"])?.hashString?.toLowerCase() ?? payload.hash;
    if (!hash) throw new Error("Transmission didn't say which torrent it added");
    if (r["torrent-duplicate"]) await this.rpc("torrent-set", { ids: [hash], labels: [this.s.category, tag].filter(Boolean) }).catch(() => null);
    if (!(await waitForTorrent(async () => (await this.get([hash])).length > 0, 5, verifyDelay()))) throw new Error("Transmission accepted the torrent but doesn't list it");
    return hash;
  }

  async list(): Promise<ActiveDownload[]> {
    return (await this.get())
      .filter((t) => !this.s.category || (t.labels ?? []).includes(this.s.category))
      .map((t) => ({
        client: this.name,
        id: t.hashString.toLowerCase(),
        name: t.name,
        sizeBytes: t.totalSize,
        progress: t.percentDone,
        downloadSpeed: t.rateDownload,
        etaSeconds: t.eta >= 0 ? t.eta : null,
        state: t.error ? "failed" : t.status === 0 && t.percentDone >= 1 ? "completed" : (STATE[t.status] ?? "downloading"),
        path: `${t.downloadDir.replace(/\/$/, "")}/${t.name}`,
      }));
  }

  async pause(id: string) {
    await this.rpc("torrent-stop", { ids: [id] });
  }

  async resume(id: string) {
    await this.rpc("torrent-start", { ids: [id] });
  }

  async remove(id: string, deleteFiles: boolean) {
    await this.rpc("torrent-remove", { ids: [id], "delete-local-data": deleteFiles });
  }
}
