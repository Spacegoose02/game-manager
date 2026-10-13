import type {
  ApiTokenInfo,
  AuthProviders,
  GameDetail,
  GameListing,
  GameSummary,
  LibraryStats,
  SaveBackup,
  User,
  UserGameState,
} from "@lootden/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface Me {
  user: User | null;
  role: "admin" | "user";
  via: string;
}

export interface HomeData {
  featured: Array<GameSummary & { backgroundUrl: string | null; blurb: string | null }>;
  sections: Array<{ id: string; title: string; games: GameSummary[] }>;
}

export interface Candidate {
  provider: string;
  providerId: string;
  name: string;
  year: number | null;
  coverUrl: string | null;
  score: number;
}

export interface NewsItem {
  feedId: string;
  feedTitle: string;
  title: string;
  link: string;
  publishedAt: string | null;
  summary: string;
  image: string | null;
}

export interface GameFilters {
  search?: string;
  genre?: string;
  controller?: string;
  kidSafe?: boolean;
  missingMetadata?: boolean;
  sort?: string;
  order?: string;
}

const qs = (o: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export interface Connectors {
  qbittorrent: { url: string; username: string; password: string; category: string; savePath: string };
  sabnzbd: { url: string; apiKey: string; category: string };
  prowlarr: { url: string; apiKey: string; categories: number[] };
  import: {
    mode: "copy" | "move" | "off";
    pathMappings: Array<{ from: string; to: string }>;
    tidy: { stripJunk: boolean; extract: boolean; repack: "zip" | "folder" };
  };
}

export interface SearchResult {
  guid: string;
  title: string;
  sizeBytes: number;
  indexer: string;
  protocol: "torrent" | "usenet";
  downloadUrl: string;
  infoUrl: string | null;
  seeders: number | null;
  leechers: number | null;
  publishedAt: string | null;
}

export interface LiveDownload {
  client: string;
  id: string;
  name: string;
  sizeBytes: number;
  progress: number;
  downloadSpeed: number;
  etaSeconds: number | null;
  state: string;
  path: string | null;
}

export interface DownloadRecord {
  id: number;
  client: string;
  name: string;
  addedAt: string;
  status: string;
  importedPath: string | null;
  error: string | null;
  live: LiveDownload | null;
}

export interface Integrations {
  settings: {
    publicUrl: string;
    igdb: { clientId: string; clientSecret: string };
    rawg: { apiKey: string };
    steamgriddb: { apiKey: string };
    oidc: { issuer: string; clientId: string; clientSecret: string; name: string; adminGroup: string; autoCreate: boolean };
  };
  fromEnvironment: string[];
  callbackUrl: string | null;
}

export interface ArtworkOption {
  url: string;
  thumb: string;
  width: number;
  height: number;
  source: string;
}

export interface ClientFile {
  name: string;
  size: number;
  modifiedAt: string;
  platform: "windows" | "linux" | "playnite" | "other";
  kind: string;
}

export interface ListingResult {
  source: string;
  items: GameListing[];
}

export interface Video {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  channel: string;
  publishedAt: string | null;
}

export interface VideoGroup {
  id: string;
  title: string;
  intervalMinutes: number;
  channels: Array<{ id: string; name: string }>;
}

async function upload<T>(method: string, path: string, body: Blob, contentType: string): Promise<T> {
  const res = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": contentType }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Upload failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  providers: () => call<AuthProviders>("GET", "/api/auth/providers"),
  setup: (username: string, password: string) => call<User>("POST", "/api/auth/setup", { username, password }),
  login: (username: string, password: string) => call<{ user: User }>("POST", "/api/auth/login", { username, password }),
  logout: () => call("POST", "/api/auth/logout"),
  me: () => call<Me>("GET", "/api/me"),
  updateMe: (patch: { displayName?: string; avatar?: string }) => call<User>("PATCH", "/api/me", patch),
  changePassword: (currentPassword: string, newPassword: string) => call("POST", "/api/me/password", { currentPassword, newPassword }),
  tokens: () => call<ApiTokenInfo[]>("GET", "/api/me/tokens"),
  createToken: (name: string) => call<{ id: number; token: string }>("POST", "/api/me/tokens", { name }),
  revokeToken: (id: number) => call("DELETE", `/api/me/tokens/${id}`),
  myGames: () => call<UserGameState[]>("GET", "/api/me/games"),

  home: () => call<HomeData>("GET", "/api/home"),
  games: (f: GameFilters = {}) => call<GameSummary[]>("GET", `/api/games${qs({ ...f })}`),
  genres: () => call<Array<{ name: string; count: number }>>("GET", "/api/genres"),
  game: (id: string) => call<GameDetail>("GET", `/api/games/${id}`),
  updateGame: (id: string, patch: { title?: string | null; kidSafe?: boolean | null; controllerSupport?: string | null }) =>
    call<GameDetail>("PATCH", `/api/games/${id}`, patch),
  searchMetadata: (id: string, q: string) => call<Candidate[]>("GET", `/api/games/${id}/metadata/search${qs({ q })}`),
  applyMetadata: (id: string, provider: string, providerId: string) => call<GameDetail>("PUT", `/api/games/${id}/metadata`, { provider, providerId }),
  clearMetadata: (id: string) => call("DELETE", `/api/games/${id}/metadata`),

  stats: () => call<LibraryStats>("GET", "/api/library/stats"),
  rescan: () => call<LibraryStats>("POST", "/api/library/rescan"),
  metadataStatus: () => call<{ providers: string[]; queued: number; running: boolean; matched: number; unmatched: number }>("GET", "/api/metadata/status"),
  refreshMetadata: (force = false) => call<{ queued: number }>("POST", "/api/metadata/refresh", { force }),

  users: () => call<User[]>("GET", "/api/users"),
  createUser: (u: { username: string; password?: string; displayName?: string; role?: string; kidMode?: boolean }) => call<User>("POST", "/api/users", u),
  updateUser: (id: number, patch: Partial<{ displayName: string; role: string; kidMode: boolean; password: string | null }>) =>
    call<User>("PATCH", `/api/users/${id}`, patch),
  deleteUser: (id: number) => call("DELETE", `/api/users/${id}`),

  connectors: () => call<Connectors>("GET", "/api/connectors"),
  saveConnectors: (c: Partial<Connectors>) => call<Connectors>("PUT", "/api/connectors", c),
  testConnector: (name: string) => call<{ message: string }>("POST", `/api/connectors/${name}/test`),
  searchDownloads: (q: string) => call<SearchResult[]>("GET", `/api/downloads/search${qs({ q })}`),
  grab: (r: { url: string; title: string; protocol: string }) => call<DownloadRecord>("POST", "/api/downloads", r),
  downloads: () => call<{ downloads: DownloadRecord[]; other: LiveDownload[] }>("GET", "/api/downloads"),
  controlDownload: (id: number, action: string, deleteFiles = false) => call("POST", `/api/downloads/${id}`, { action, deleteFiles }),

  news: () => call<{ items: NewsItem[]; errors: Array<{ feedId: string; error: string }> }>("GET", "/api/news"),
  integrations: () => call<Integrations>("GET", "/api/settings/integrations"),
  saveIntegrations: (s: Partial<Integrations["settings"]>) => call<Integrations>("PUT", "/api/settings/integrations", s),
  testIntegration: (name: string) => call<{ message: string }>("POST", `/api/settings/integrations/${name}/test`),

  artworkOptions: (id: string, kind: string, q = "") => call<ArtworkOption[]>("GET", `/api/games/${id}/artwork/${kind}${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  setArtworkUrl: (id: string, kind: string, url: string) => call<GameDetail>("PUT", `/api/games/${id}/artwork/${kind}`, { url }),
  uploadArtwork: (id: string, kind: string, file: File) => upload<GameDetail>("PUT", `/api/games/${id}/artwork/${kind}`, file, file.type || "image/jpeg"),
  resetArtwork: (id: string, kind: string) => call<GameDetail>("DELETE", `/api/games/${id}/artwork/${kind}`),

  clients: () => call<ClientFile[]>("GET", "/api/clients"),
  uploadClient: (file: File) => upload<ClientFile>("PUT", `/api/clients/${encodeURIComponent(file.name)}`, file, "application/octet-stream"),
  deleteClient: (name: string) => call("DELETE", `/api/clients/${encodeURIComponent(name)}`),
  fetchRelease: (repo: string) => call<{ tag: string; files: string[] }>("POST", "/api/clients/github", { repo }),

  saves: (id: string) => call<SaveBackup[]>("GET", `/api/games/${id}/saves`),
  uploadSave: (id: string, file: File) => upload<SaveBackup>("POST", `/api/games/${id}/saves?device=${encodeURIComponent("Web upload")}`, file, "application/octet-stream"),
  deleteSave: (id: string, saveId: number) => call("DELETE", `/api/games/${id}/saves/${saveId}`),
  setSavePath: (id: string, path: string | null) => call<GameDetail>("PUT", `/api/games/${id}/save-path`, { path }),
  suggestSavePath: (id: string) => call<{ paths: string[] }>("GET", `/api/games/${id}/save-path/suggest`),

  calendar: (days = 120, platform = "pc") => call<ListingResult>("GET", `/api/calendar${qs({ days: String(days), platform })}`),
  discover: () => call<{ trending: ListingResult; upcoming: ListingResult }>("GET", "/api/discover"),
  discoverSearch: (q: string) => call<GameListing[]>("GET", `/api/discover/search${qs({ q })}`),
  videos: () => call<{ groups: Array<{ id: string; title: string; videos: Video[] }>; errors: string[] }>("GET", "/api/videos"),
  videoGroups: () => call<VideoGroup[]>("GET", "/api/videos/groups"),
  saveVideoGroups: (groups: Array<{ id?: string; title: string; intervalMinutes: number; channels: string[] }>) =>
    call<VideoGroup[]>("PUT", "/api/videos/groups", { groups }),

  feeds: () => call<Array<{ id: string; url: string; title: string }>>("GET", "/api/news/feeds"),
  addFeed: (url: string, title?: string) => call("POST", "/api/news/feeds", { url, title }),
  removeFeed: (id: string) => call("DELETE", `/api/news/feeds/${id}`),
};

export const avatarUrl = (seed: string) => `/api/avatars/${encodeURIComponent(seed)}.svg`;

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatPlaytime(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
