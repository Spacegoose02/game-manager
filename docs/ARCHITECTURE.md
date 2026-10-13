# Architecture

```
               Unraid / Docker host                                Gaming PCs
 ┌─────────────────────────────────────────────┐        ┌──────────────────────────────────┐
 │ lootden container                           │        │ Desktop app (Electron)           │
 │                                             │  HTTP  │  shows the server's web UI       │
 │  watcher + scanner ─► library (SQLite)      │ ◄────► │  install engine: download,       │
 │  metadata: IGDB ─ Steam ─ PCGamingWiki      │ cookie │  unpack (7-Zip), delete archives │
 │  auth: local, OIDC (TinyAuth), fwd headers  │  or    │  play-time tracking              │
 │  REST API, ranged file downloads, web UI    │ token  │                                  │
 │  connectors: Prowlarr, qBittorrent, SABnzbd │        │ Playnite plugin ─► lootden://     │
 │                                             │        │ gm CLI (same engine)             │
 │  /games  /downloads  /data (db, covers)     │        │                                  │
 └─────────────────────────────────────────────┘        └──────────────────────────────────┘
```

## Packages

| Path | What it is |
| --- | --- |
| `packages/shared` | API types and archive helpers (split-volume grouping, safe folder names). No dependencies. |
| `packages/server` | Fastify 5 server. `src/index.ts` runs it; `src/lib.ts` exposes `buildApp` for tests. |
| `packages/web` | React 19 + Vite web UI, served by the server and shown inside the desktop app. |
| `packages/client` | Install engine (`installer`, `downloader`, `extractor`, `installed`, `launcher`, `drives`) and the `gm` CLI. |
| `packages/desktop` | Electron shell: loads the server's UI and gives it install/play/uninstall through a preload bridge. |
| `playnite` | C# Playnite library plugin. |

## Server

- **Library** (`catalog/`): each top-level folder or root archive in `/games` is one game,
  with id `sha1(name)` (first 12 hex characters), so ids survive restarts and renames
  change them. The scan lives in memory; SQLite keeps when each game was first seen,
  admin overrides and metadata. `fs.watch` (recursive) triggers a rescan 15 seconds
  after the last change; the interval rescan catches anything the watcher misses
  (some network filesystems don't report changes).
- **Metadata** (`metadata/`): titles are cleaned (`The.Sims.4.v1.98-GROUP` → `The Sims 4`)
  and matched by similarity; matches below 0.6 are left for an admin to pick. IGDB is
  used when keys are set (throttled to about 3 requests/second, under IGDB's limit of
  4), then Steam's store API, with PCGamingWiki filling in controller support. Covers are
  cached in `/data/covers`. Kid-safe comes from age ratings (ESRB E/E10+, PEGI 3/7,
  USK 0/6, and equivalents); an admin override wins.
- **Auth** (`auth/`): passwords use scrypt. Browser sessions are an HTTP-only cookie whose
  sha256 is stored. Devices (desktop app, Playnite, `gm`) use personal tokens `gmt_…`,
  also stored hashed. OIDC uses `openid-client` with PKCE. Forward-auth headers are
  only read from `GM_TRUSTED_PROXIES`. Kid profiles get a filtered library server-side.
- **Connectors** (`connectors/`): Prowlarr search (category 4000, PC games); grabs go
  to qBittorrent (tagged `gm-<id>`) or SABnzbd. Every minute, finished downloads are
  copied or moved into `/games` (via `<name>.importing`, renamed when complete so the
  scanner never sees half a game). Connector secrets live in the database and are
  never sent back to the browser in full.
- **News**: RSS/Atom feeds the admin lists, cached for 30 minutes.

## Install engine (client)

1. Fetch the game's file list. Each file downloads with HTTP Range into `<name>.part`,
   resuming if a `.part` exists, then renamed.
2. Archives are grouped into sets (`.part1.rar`, `.r00`, `.7z.001`, `.z01`). Each set is
   extracted once with 7-Zip; **only after 7-Zip succeeds** are its volumes deleted.
3. If everything unpacked into one wrapper folder, its contents move up a level.
4. `.game-manager.json` is written into the install folder (game id, title, chosen exe).
   Uninstall refuses to delete any folder without it.
5. The install is reported to the server, so the profile and Playnite know about it.

7-Zip is looked up in this order: configured path, `Program Files\7-Zip`, `7zz`/`7z` on
PATH, then the bundled `7za` (zip and 7z only; RAR needs a full 7-Zip).

## Desktop app

The window loads the server's web UI. `preload.ts` exposes `window.gameManager`
(install, play, uninstall, drives, choose folder) and the main process only answers
calls coming from the configured server's origin. On first use it turns the browser
session into a device token. It registers `lootden://install/<id>` so web links
and the Playnite plugin can start installs.

## Choices and why

- **TypeScript on Node 22 everywhere** so server, web and client share types, and the
  install engine runs the same in the desktop app and the CLI.
- **`node:sqlite`** (built into Node 22) instead of a native module: nothing to compile
  in Docker or on Unraid.
- **The desktop app reuses the web UI** rather than a second UI, so features land in
  both at once.
- **7-Zip instead of JavaScript unpackers**: it handles every split RAR/7z/zip format and
  is fast on multi-gigabyte games.
