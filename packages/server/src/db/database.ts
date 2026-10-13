import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/**
 * Ordered schema migrations. Append only: never edit a migration that has shipped,
 * add a new one instead. user_version tracks how many have run.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE games (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL,
    removed_at TEXT,
    title_override TEXT,
    kid_safe_override INTEGER,
    controller_override TEXT
  );

  CREATE TABLE metadata (
    game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT,
    cover_url TEXT,
    screenshots TEXT NOT NULL DEFAULT '[]',
    genres TEXT NOT NULL DEFAULT '[]',
    themes TEXT NOT NULL DEFAULT '[]',
    game_modes TEXT NOT NULL DEFAULT '[]',
    release_date TEXT,
    rating REAL,
    age_ratings TEXT NOT NULL DEFAULT '[]',
    controller_support TEXT,
    steam_app_id TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    fetched_at TEXT NOT NULL
  );

  -- Remembers failed lookups so unmatched games are not retried on every scan.
  CREATE TABLE metadata_attempts (
    game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    attempted_at TEXT NOT NULL,
    error TEXT
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    email TEXT COLLATE NOCASE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    avatar TEXT NOT NULL,
    kid_mode INTEGER NOT NULL DEFAULT 0,
    oidc_subject TEXT UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );

  CREATE TABLE api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE user_games (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL,
    device TEXT NOT NULL,
    installed_at TEXT,
    uninstalled_at TEXT,
    install_path TEXT,
    playtime_seconds INTEGER NOT NULL DEFAULT 0,
    last_played_at TEXT,
    PRIMARY KEY (user_id, game_id, device)
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  -- Downloads sent to torrent/usenet clients, so finished ones can be imported into the library.
  CREATE TABLE downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client TEXT NOT NULL CHECK (client IN ('qbittorrent', 'sabnzbd')),
    external_id TEXT,
    name TEXT NOT NULL,
    source_url TEXT,
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    added_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'downloading',
    imported_path TEXT,
    imported_at TEXT,
    error TEXT
  );
  CREATE INDEX downloads_status ON downloads(status);
  `,
  `
  -- Admin-chosen artwork: an http(s) URL, or "upload:<time>" for a file in <data>/artwork.
  ALTER TABLE games ADD COLUMN cover_override TEXT;
  ALTER TABLE games ADD COLUMN background_override TEXT;
  `,
  `
  -- Where a game keeps its saves on a player's PC ("%APPDATA%/Studio/Game" or "{game}/saves").
  ALTER TABLE games ADD COLUMN save_path TEXT;
  -- Save backups uploaded per player, so they can carry progress between devices.
  CREATE TABLE saves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    size INTEGER NOT NULL,
    device TEXT,
    file TEXT NOT NULL
  );
  CREATE INDEX saves_user_game ON saves(user_id, game_id, created_at);
  `,
  `
  -- Downloads meant for the Emulation shelf go to Emulation/<platform>/ instead of the PC games.
  ALTER TABLE downloads ADD COLUMN platform TEXT;
  -- BIOS and firmware files admins upload once for every player's emulators.
  CREATE TABLE bios_files (
    name TEXT PRIMARY KEY,
    emulator TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha1 TEXT NOT NULL,
    uploaded_at TEXT NOT NULL
  );
  `,
  `
  -- Games found in the downloads folder and imported (or tried) from there.
  CREATE TABLE folder_imports (
    name TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    target TEXT,
    error TEXT,
    at TEXT NOT NULL
  );
  `,
  `
  -- The household wishlist: synced from Steam, filled by RSS list feeds or added by hand.
  CREATE TABLE wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    title_key TEXT NOT NULL UNIQUE,
    steam_app_id INTEGER,
    url TEXT,
    image TEXT,
    release_date TEXT,
    date_text TEXT,
    sources TEXT NOT NULL DEFAULT '[]',
    added_at TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE wishlist_feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    checked_at TEXT,
    error TEXT,
    item_count INTEGER NOT NULL DEFAULT 0
  );
  -- Dates people add to the release calendar themselves.
  CREATE TABLE calendar_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    note TEXT,
    url TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL
  );
  `,
];

export function openDatabase(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function now(): string {
  return new Date().toISOString();
}

export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
