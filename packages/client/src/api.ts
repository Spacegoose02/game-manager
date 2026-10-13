import type { ActivityEvent, GameDetail, GameSummary, HealthResponse, LibraryStats, User } from "@game-manager/shared";
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
  fileUrl(gameId: string, index: number): string {
    return `${this.base}/api/games/${encodeURIComponent(gameId)}/files/${index}`;
  }
}
