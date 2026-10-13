// Types and helpers shared by the server and the client.
// Keep this package dependency-free so both sides can import it anywhere.

export * from "./emulators.js";
export * from "./platforms.js";

export const API_VERSION = 1;

export type ArchiveKind = "zip" | "7z" | "rar";

export interface GameFile {
  /** Position in the game's file list; used in download URLs so no paths travel over the wire. */
  index: number;
  /** Path relative to the game's root, always with forward slashes. */
  path: string;
  size: number;
  /** Last modified time, ISO 8601. */
  modifiedAt: string;
  /** Set when the file is an archive (or the first/other volume of one) the client should unpack. */
  archive?: ArchiveKind;
}

export type ControllerSupport = "full" | "partial" | "none";

export interface AgeRating {
  /** Rating board, e.g. "ESRB", "PEGI", "USK". */
  organization: string;
  /** Rating as the board writes it, e.g. "E10+", "12", "M". */
  rating: string;
}

export interface GameSummary {
  /** Stable id derived from the game's path in the library. */
  id: string;
  title: string;
  /** Folder or file name in the library, relative to the games folder ("Emulation/ps1/Game" for emulated games). */
  source: string;
  /** "folder" = a directory of files; "archive" = a single archive file; "file" = a single ROM or disc image. */
  layout: "folder" | "archive" | "file";
  /** "pc", or the emulated system from Emulation/<platform>/. See PLATFORMS. */
  platform: string;
  sizeBytes: number;
  fileCount: number;
  /** True when at least one file needs unpacking after download. */
  packed: boolean;
  /**
   * "disc": a disc image (ISO) and "installer": a setup program. Both are installed once
   * on a PC with the app, then the installed folder is zipped back onto the server.
   */
  needsSetup: "disc" | "installer" | null;
  modifiedAt: string;
  /** When the server first saw this game. */
  addedAt: string;
  /** Server-relative URL of the cover image, when metadata has one. */
  coverUrl: string | null;
  genres: string[];
  releaseYear: number | null;
  /** 0-100 critic/user rating when known. */
  rating: number | null;
  controllerSupport: ControllerSupport | null;
  /** True/false when known from age ratings or an admin override; null when unknown. */
  kidSafe: boolean | null;
}

export interface GameMetadata {
  provider: string;
  providerId: string;
  name: string;
  summary: string | null;
  coverUrl: string | null;
  screenshots: string[];
  genres: string[];
  themes: string[];
  gameModes: string[];
  releaseDate: string | null;
  rating: number | null;
  ageRatings: AgeRating[];
  controllerSupport: ControllerSupport | null;
  steamAppId: string | null;
  /** Manually matched by an admin; automatic refreshes leave it alone. */
  locked: boolean;
  fetchedAt: string;
}

export interface GameDetail extends GameSummary {
  files: GameFile[];
  metadata: GameMetadata | null;
  /** Server-relative URL of a wide background image, when there is one. */
  backgroundUrl: string | null;
  /** Admin overrides; null means "use metadata". cover/background: an image URL or "upload:..." */
  overrides: {
    title: string | null;
    kidSafe: boolean | null;
    controllerSupport: ControllerSupport | null;
    cover: string | null;
    background: string | null;
  };
  /**
   * Where the game keeps saves on a player's PC, for save sync. Uses %APPDATA%,
   * %LOCALAPPDATA%, %USERPROFILE%, %DOCUMENTS% and {game} (the install folder).
   */
  savePath: string | null;
}

/** A save backup a player uploaded for one game. */
export interface SaveBackup {
  id: number;
  gameId: string;
  createdAt: string;
  size: number;
  /** The computer it came from, as the client named it. */
  device: string | null;
}

export interface LibraryStats {
  gameCount: number;
  totalBytes: number;
  lastScanAt: string | null;
  lastScanMs: number | null;
  disk: { freeBytes: number; totalBytes: number } | null;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  apiVersion: number;
}

export type Role = "admin" | "user";

export interface User {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  /** Seed for the generated gaming avatar; GET /api/avatars/<seed>.svg */
  avatar: string;
  /** Kid profiles only see games known to be kid-safe. */
  kidMode: boolean;
  hasPassword: boolean;
  createdAt: string;
}

export interface ApiTokenInfo {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AuthProviders {
  local: boolean;
  oidc: { enabled: boolean; name: string };
  /** Reverse-proxy login such as TinyAuth forward auth. */
  header: boolean;
  /** True until the first admin account exists. */
  setupRequired: boolean;
}

export type ActivityEvent = "installed" | "uninstalled" | "played";

export interface UserGameState {
  gameId: string;
  device: string;
  installedAt: string | null;
  uninstalledAt: string | null;
  installPath: string | null;
  playtimeSeconds: number;
  lastPlayedAt: string | null;
}

const ARCHIVE_PATTERNS: Array<[RegExp, ArchiveKind]> = [
  [/\.zip$/i, "zip"],
  [/\.z\d{2}$/i, "zip"],
  [/\.zip\.\d{3}$/i, "zip"],
  [/\.7z$/i, "7z"],
  [/\.7z\.\d{3}$/i, "7z"],
  [/\.rar$/i, "rar"],
  [/\.r\d{2}$/i, "rar"],
];

/** Detects archive files, including the extra volumes of split archives. */
export function archiveKindOf(fileName: string): ArchiveKind | undefined {
  for (const [pattern, kind] of ARCHIVE_PATTERNS) {
    if (pattern.test(fileName)) return kind;
  }
  return undefined;
}

export interface ArchiveSet {
  kind: ArchiveKind;
  /** The volume to hand to the extractor. */
  first: string;
  /** Every file belonging to the set, first volume included; all are removed after a successful unpack. */
  volumes: string[];
}

/**
 * Groups archive paths into sets so split archives are extracted once and all
 * their volumes are cleaned up together. Handles:
 *   game.part1.rar / game.part01.rar ...   (RAR5 style)
 *   game.rar + game.r00, game.r01 ...      (old RAR style)
 *   game.7z.001, game.7z.002 ...
 *   game.zip.001 ... / game.zip + game.z01 ...
 * Paths keep their directory, so volumes only group within the same folder.
 */
export function groupArchiveSets(paths: string[]): ArchiveSet[] {
  const sets = new Map<string, ArchiveSet>();
  const add = (key: string, kind: ArchiveKind, path: string, isFirst: boolean) => {
    let set = sets.get(key);
    if (!set) {
      set = { kind, first: "", volumes: [] };
      sets.set(key, set);
    }
    set.volumes.push(path);
    if (isFirst) set.first = path;
  };

  for (const path of paths) {
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^(.*)\.part(\d+)\.rar$/i))) {
      add(`rar:${m[1]!.toLowerCase()}`, "rar", path, Number(m[2]) === 1);
    } else if ((m = path.match(/^(.*)\.(rar|r\d{2})$/i))) {
      add(`rar:${m[1]!.toLowerCase()}`, "rar", path, m[2]!.toLowerCase() === "rar");
    } else if ((m = path.match(/^(.*)\.(7z|zip)\.(\d{3})$/i))) {
      const kind = m[2]!.toLowerCase() as ArchiveKind;
      add(`${kind}:${m[1]!.toLowerCase()}`, kind, path, Number(m[3]) === 1);
    } else if ((m = path.match(/^(.*)\.(zip|z\d{2})$/i))) {
      add(`zip:${m[1]!.toLowerCase()}`, "zip", path, m[2]!.toLowerCase() === "zip");
    } else if ((m = path.match(/^(.*)\.7z$/i))) {
      add(`7z:${m[1]!.toLowerCase()}`, "7z", path, true);
    }
  }

  return [...sets.values()]
    .filter((s) => s.first !== "")
    .map((s) => ({ ...s, volumes: [...s.volumes].sort() }));
}

/** Disc images and setup programs that need installing once before the game can be played. */
export function setupKindOf(files: Array<{ path: string }>): "disc" | "installer" | null {
  const names = files.map((f) => f.path.toLowerCase());
  if (names.some((n) => /\.(iso|mdf|nrg|cue)$/.test(n))) return "disc";
  // Repack installers: setup.exe beside its .bin data files, at the top or one folder down.
  const top = names.filter((n) => n.split("/").length <= 2);
  const setup = top.some((n) => /(^|\/)(setup|install(er)?)[^/]*\.exe$/.test(n));
  if (setup && (top.some((n) => /\.bin$/.test(n)) || files.length <= 2)) return "installer";
  return null;
}

/** Makes a string safe to use as a single folder name on Windows and Linux. */
export function safeFolderName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  if (!cleaned || reserved.test(cleaned)) return `game-${cleaned || "untitled"}`;
  return cleaned;
}

/** A game from a metadata service that may not be in the library: release calendar and Discover. */
export interface GameListing {
  provider: string;
  providerId: string;
  name: string;
  /** YYYY-MM-DD when the day is known. */
  releaseDate: string | null;
  /** The date as the service words it when the day isn't known ("Q1 2027", "Coming soon"). */
  dateText: string | null;
  /** Portrait cover, when the service has one. */
  coverUrl: string | null;
  /** Wide image for cards. */
  imageUrl: string | null;
  platforms: string[];
  genres: string[];
  /** The game's page on the service. */
  url: string | null;
  /** The library game with the same title, when there is one. */
  libraryId: string | null;
  /** On the household wishlist. */
  wishlisted?: boolean;
  /** Calendar entries people added themselves: their note, and whether this viewer may delete it. */
  note?: string | null;
  canDelete?: boolean;
}

/** Everything the Discover game page shows about a game that may not be in the library. */
export interface GameInfo extends GameListing {
  summary: string | null;
  screenshots: string[];
  /** A YouTube video id, or a direct video file from the store. */
  trailer: { youtubeId: string } | { url: string; poster: string | null } | null;
  /** 0-100 critic/user rating when known. */
  rating: number | null;
  developers: string[];
  ageRatings: AgeRating[];
}
