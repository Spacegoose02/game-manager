import type { FetchLike } from "../metadata/http.js";
import type { ConnectorSettings } from "./settings.js";
import { waitForTorrent, type TorrentPayload } from "./torrent.js";
import { verifyDelay, type ActiveDownload, type TorrentClient } from "./types.js";

interface DelugeStatus {
  name: string;
  total_size: number;
  progress: number;
  download_payload_rate: number;
  eta: number;
  state: string;
  save_path: string;
  label?: string;
}

const STATE: Record<string, ActiveDownload["state"]> = {
  Downloading: "downloading",
  Seeding: "seeding",
  Paused: "paused",
  Checking: "checking",
  Queued: "queued",
  Error: "failed",
  Moving: "checking",
  Allocating: "checking",
};

/** Deluge's Web UI JSON-RPC (Deluge 2). Uses the Label plugin for the category when it's on. */
export class DelugeClient implements TorrentClient {
  readonly name = "deluge" as const;
  private cookie: string | null = null;
  private id = 0;

  constructor(
    private readonly s: ConnectorSettings["deluge"],
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get configured(): boolean {
    return !!this.s.url;
  }

  private async raw<T>(method: string, params: unknown[]): Promise<T> {
    const res = await this.fetchImpl(`${this.s.url.replace(/\/json$/, "")}/json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: JSON.stringify({ method, params, id: ++this.id }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Deluge answered ${res.status}`);
    const set = res.headers.get("set-cookie")?.match(/_session_id=[^;]+/)?.[0];
    if (set) this.cookie = set;
    const body = (await res.json()) as { result: T; error: { message: string; code: number } | null };
    if (body.error) {
      if (body.error.code === 1) this.cookie = null; // not authenticated
      throw new Error(`Deluge: ${body.error.message}`);
    }
    return body.result;
  }

  private async ensure(): Promise<void> {
    if (!this.cookie) {
      if (!(await this.raw<boolean>("auth.login", [this.s.password]))) throw new Error("Deluge rejected the password");
    }
    // The web UI talks to a daemon; connect it to the first one if it isn't yet.
    if (!(await this.raw<boolean>("web.connected", []))) {
      const hosts = await this.raw<Array<[string, ...unknown[]]>>("web.get_hosts", []);
      if (!hosts.length) throw new Error("Deluge's web UI has no daemon to connect to");
      await this.raw("web.connect", [hosts[0]![0]]);
    }
  }

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    await this.ensure();
    try {
      return await this.raw<T>(method, params);
    } catch (err) {
      if (this.cookie) throw err;
      await this.ensure();
      return this.raw<T>(method, params);
    }
  }

  async test(): Promise<string> {
    const version = await this.call<string>("daemon.get_version").catch(() => "2");
    return `Deluge ${version}`;
  }

  add(url: string): Promise<string | null> {
    return this.addTorrent({ magnet: url, hash: null }, `gm-${Date.now()}`);
  }

  async addTorrent(payload: TorrentPayload, _tag: string): Promise<string> {
    const options = this.s.savePath ? { download_location: this.s.savePath } : {};
    const added =
      "magnet" in payload
        ? await this.call<string | null>("core.add_torrent_magnet", [payload.magnet, options])
        : await this.call<string | null>("core.add_torrent_file", [payload.name, Buffer.from(payload.file).toString("base64"), options]).catch((err: Error) => {
            // Deluge refuses torrents it already has; that's fine when we know the hash.
            if (/already/i.test(err.message) && payload.hash) return payload.hash;
            throw err;
          });
    const hash = (added ?? payload.hash)?.toLowerCase();
    if (!hash) throw new Error("Deluge didn't add the torrent (it may already be in Deluge)");
    if (this.s.category) {
      await this.call("label.add", [this.s.category]).catch(() => null);
      await this.call("label.set_torrent", [hash, this.s.category]).catch(() => null);
    }
    const has = async () => Object.keys(await this.call<Record<string, unknown>>("core.get_torrents_status", [{ id: [hash] }, ["name"]])).length > 0;
    if (!(await waitForTorrent(has, 5, verifyDelay()))) throw new Error("Deluge accepted the torrent but doesn't list it");
    return hash;
  }

  async list(): Promise<ActiveDownload[]> {
    const fields = ["name", "total_size", "progress", "download_payload_rate", "eta", "state", "save_path", "label"];
    const all = await this.call<Record<string, DelugeStatus>>("core.get_torrents_status", [{}, fields]);
    return Object.entries(all)
      .filter(([, t]) => !this.s.category || t.label === undefined || t.label === this.s.category)
      .map(([hash, t]) => ({
        client: this.name,
        id: hash.toLowerCase(),
        name: t.name,
        sizeBytes: t.total_size,
        progress: t.progress / 100,
        downloadSpeed: t.download_payload_rate,
        etaSeconds: t.eta > 0 ? t.eta : null,
        state: t.state === "Paused" && t.progress >= 100 ? "completed" : (STATE[t.state] ?? "downloading"),
        path: `${t.save_path.replace(/\/$/, "")}/${t.name}`,
      }));
  }

  async pause(id: string) {
    await this.call("core.pause_torrent", [[id]]);
  }

  async resume(id: string) {
    await this.call("core.resume_torrent", [[id]]);
  }

  async remove(id: string, deleteFiles: boolean) {
    await this.call("core.remove_torrent", [id, deleteFiles]);
  }
}
