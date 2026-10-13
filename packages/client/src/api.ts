import type { ActivityEvent, GameDetail, GameSummary, HealthResponse, LibraryStats, SaveBackup, User } from "@lootden/shared";
import type { ClientConfig } from "./config.js";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class GameServerClient {
  private readonly base: string;

  constructor(private readonly config: Pick<ClientConfig, "serverUrl" | "apiToken">) {
    this.base = config.serverUrl.replace(/\/+$/, "");
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.config.apiToken ? { Authorization: `Bearer ${this.config.apiToken}`, ...extra } : extra;
  }

  private async json<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.base + pathname, { ...init, headers: this.headers() });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(`${init.method ?? "GET"} ${pathname} failed with ${res.status}: ${body}`, res.status);
    }
    return (await res.json()) as T;
  }

  health() {
    return this.json<HealthResponse>("/api/health");
  }
  listGames(search?: string) {
    return this.json<GameSummary[]>(`/api/games${search ? `?search=${encodeURIComponent(search)}` : ""}`);
  }
  getGame(id: string) {
    return this.json<GameDetail>(`/api/games/${encodeURIComponent(id)}`);
  }
  stats() {
    return this.json<LibraryStats>("/api/library/stats");
  }
  rescan() {
    return this.json<LibraryStats>("/api/library/rescan", { method: "POST" });
  }
  /** Exchanges a username and password for a personal API token for this device. */
  async login(username: string, password: string, device: string): Promise<{ token: string; user: User }> {
    const res = await fetch(`${this.base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, client: true, device }),
    });
    const body = (await res.json().catch(() => ({}))) as { token: string; user: User; error?: string };
    if (!res.ok) throw new ApiError(body.error ?? `Login failed with ${res.status}`, res.status);
    return body;
  }
  me() {
    return this.json<{ user: User | null; role: string; via: string }>("/api/me");
  }
  /** Install/uninstall/playtime reports; ignored for the service token, which has no profile. */
  async reportActivity(a: { gameId: string; device: string; event: ActivityEvent; installPath?: string; seconds?: number }): Promise<void> {
    await fetch(`${this.base}/api/me/activity`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(a),
    }).catch(() => undefined);
  }
  listSaves(gameId: string) {
    return this.json<SaveBackup[]>(`/api/games/${encodeURIComponent(gameId)}/saves`);
  }
  async uploadSave(gameId: string, zip: Uint8Array, device: string): Promise<SaveBackup> {
    const pathname = `/api/games/${encodeURIComponent(gameId)}/saves?device=${encodeURIComponent(device)}`;
    const res = await fetch(this.base + pathname, { method: "POST", headers: this.headers({ "Content-Type": "application/octet-stream" }), body: new Blob([zip as Uint8Array<ArrayBuffer>]) });
    if (!res.ok) throw new ApiError(`Uploading saves failed with ${res.status}: ${await res.text().catch(() => "")}`, res.status);
    return (await res.json()) as SaveBackup;
  }
  async downloadSave(gameId: string, saveId: number): Promise<Uint8Array> {
    const res = await fetch(`${this.base}/api/games/${encodeURIComponent(gameId)}/saves/${saveId}`, { headers: this.headers() });
    if (!res.ok) throw new ApiError(`Downloading saves failed with ${res.status}`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }
  /** Admin: replaces a disc or installer game with a zip of the installed game, streamed from disk. */
  async uploadPrepared(gameId: string, zipPath: string, version?: string): Promise<GameDetail> {
    const { createReadStream } = await import("node:fs");
    const { stat } = await import("node:fs/promises");
    const { Readable } = await import("node:stream");
    const size = (await stat(zipPath)).size;
    const qs = version ? `?version=${encodeURIComponent(version)}` : "";
    const res = await fetch(`${this.base}/api/games/${encodeURIComponent(gameId)}/prepared${qs}`, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/octet-stream", "Content-Length": String(size) }),
      body: Readable.toWeb(createReadStream(zipPath)) as ReadableStream,
      duplex: "half",
    } as RequestInit);
    if (!res.ok) throw new ApiError(`Uploading the installed game failed with ${res.status}: ${await res.text().catch(() => "")}`, res.status);
    return (await res.json()) as GameDetail;
  }
  fileUrl(gameId: string, index: number): string {
    return `${this.base}/api/games/${encodeURIComponent(gameId)}/files/${index}`;
  }
}
