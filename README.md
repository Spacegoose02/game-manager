<p align="center"><img src="packages/web/public/logo.svg" width="96" alt=""></p>

# LootDen

A raccoon's den for your loot: a self-hosted manager for your own DRM-free PC game library.
The server runs in Docker (made for Unraid), and players install games from a Windows or
Linux desktop app that downloads, unpacks zip / 7z / rar and deletes the archives afterwards.

LootDen was called Game Manager until v0.3. Existing installs keep working: the server
still uses an existing `game-manager.db`, the desktop app keeps its settings, the
`gamemanager://` links still open the app, and the `GM_` environment variables are unchanged.

- **Server**: scans and watches your games folder, fetches covers and details from IGDB,
  RAWG, Steam, PCGamingWiki and SteamGridDB, and serves a web UI with a featured home page,
  filters (genre, controller support, kid-safe), gaming news, YouTube video rows, a release
  calendar, a Discover page for games you don't have yet, and 23 themes. Admins can replace
  any cover or background with their own image.
- **Save sync**: each profile backs up its saves per game to the server (automatically when
  you close a game in the app) and restores them on another PC.
- **Profiles**: local accounts or sign-in with TinyAuth / any OIDC provider, random gaming
  avatars, kid profiles that only see kid-safe games, and per-profile install and play-time
  tracking (exportable to Yamtrack).
- **Desktop app**: Windows exe and Linux AppImage/deb, downloadable from the server's
  **Get the app** page. Pick a drive, install, play, uninstall.
  Touch mode and controller navigation for handhelds like the ROG Ally.
- **Downloads** (admin): search Prowlarr indexers and send results to qBittorrent or SABnzbd;
  finished downloads are cleaned up (junk files removed, nested archives unpacked) and
  imported as `Title v1.2.zip`. Disc images and installers are installed once with the app,
  and the installed game is zipped back onto the server.
- **Playnite plugin**: your library inside Playnite, with installs handed to the desktop app.

See [ROADMAP.md](ROADMAP.md) for what is done and what is next.

## Library layout

Each top-level entry in the games folder is one game:

```
/mnt/user/games/
  The Sims 4/                    <- a folder: every file inside is part of the game
    The.Sims.4.part1.rar
    The.Sims.4.part2.rar
  Grand Theft Auto V.7z          <- a single archive at the root is a game too
  Stardew Valley/
    Stardew Valley.exe
    ...
```

Archives (including split sets like `.part1.rar`, `.7z.001`, `.r00`) are unpacked on the
player's PC after download, then removed. Loose files are copied as they are.

### Console games (Emulation)

Console games go in an `Emulation` folder (or `roms`), one folder per system. Every file or
folder inside a system's folder is one game, and they show up in the **Emulation** section
instead of the PC library:

```
/mnt/user/games/Emulation/
  ps1/Crash Bandicoot (USA)/Crash Bandicoot (USA).cue + .bin
  ps2/Okami (USA).iso
  ps3/Demon's Souls/PS3_GAME/USRDIR/EBOOT.BIN
  xbox/Halo (USA).iso
  snes/Super Mario World (USA).sfc
```

System folders: `ps1` (or `psx`), `ps2`, `ps3`, `xbox`, `psp`, `nes`, `snes`, `n64`, `gb`,
`gbc`, `gba`, `nds`, `gamecube`, `wii`, `genesis` (or `megadrive`), `saturn`, `dreamcast`.
Metadata is matched on that system only.

- **Desktop app:** Emulation, then Emulators and BIOS sets up RetroArch, DuckStation, PCSX2,
  RPCS3 and xemu from their official releases (RetroArch cores come from the libretro
  buildbot). BIOS files come from your own consoles: pick them on the PC, or upload them once
  on that page (admins) and press "Get BIOS files from the server" on each PC. PS3 firmware
  links to Sony's download page. **Play** starts the right emulator, tracks play time and
  syncs saves per profile: newer saves come down before you play, changed ones go up after.
- **Browser:** single-file games (cartridge ROMs, CHD, PBP, ISO, single-track BIN) for NES,
  SNES, N64, Game Boy, GBA, DS, Genesis, Saturn, PS1 and PSP play in the browser with
  EmulatorJS. The in-game save (battery save or PS1 memory card) is the same one the desktop
  app uses, so you can switch between the two. Set `GM_EMULATORJS_DATA` to a self-hosted copy
  of EmulatorJS's `data/` folder to play without its CDN.
- **Downloads:** "Send to" on the search results puts a finished download straight into a
  system's folder.

## Run the server

Docker Compose:

```sh
cp .env.example .env      # set paths, and optionally the first admin and IGDB keys
docker compose up -d --build
```

Open `http://<server>:8080`. Without `GM_ADMIN_USERNAME`/`GM_ADMIN_PASSWORD` in `.env`,
the first visit asks you to create the admin account.

On Unraid, see [docs/UNRAID.md](docs/UNRAID.md).

### Settings

All settings are environment variables; [.env.example](.env.example) lists them with comments.
The important ones:

| Variable | What it does |
| --- | --- |
| `GM_ADMIN_USERNAME`, `GM_ADMIN_PASSWORD` | Creates this admin at first startup (ignored once any account exists) |
| `GM_PUBLIC_URL` | The address people use, e.g. `https://games.example.com`; needed for OIDC |
| `GM_IGDB_CLIENT_ID`, `GM_IGDB_CLIENT_SECRET` | Twitch app keys for IGDB (free at dev.twitch.tv). Without them, Steam and PCGamingWiki are used |
| `GM_RAWG_API_KEY`, `GM_STEAMGRIDDB_API_KEY` | Optional RAWG metadata and SteamGridDB artwork (both free) |
| `GM_METADATA_AUTO` | Match new games automatically (default `true`) |
| `GM_WATCH`, `GM_SCAN_INTERVAL_MINUTES` | Folder watching (default on) and the backup rescan interval (default 30) |
| `GM_OIDC_ISSUER`, `GM_OIDC_CLIENT_ID`, `GM_OIDC_CLIENT_SECRET` | Sign in with TinyAuth or another OIDC provider |
| `GM_OIDC_NAME`, `GM_OIDC_ADMIN_GROUP`, `GM_OIDC_AUTO_CREATE` | Button label, group that makes someone admin, create profiles on first login |
| `GM_AUTH_HEADER_USER`, `GM_TRUSTED_PROXIES`, `GM_AUTH_HEADER_ADMIN_GROUP` | Trust forward-auth headers (e.g. `Remote-User`) from these proxy addresses |
| `GM_API_TOKEN` | Optional admin token for scripts |
| `GM_EMULATORJS_DATA` | Where the browser emulator loads from (default: the EmulatorJS CDN) |

You don't need environment variables for keys or sign-in: **Admin, Connections and sign-in**
sets the public address, TinyAuth/OIDC and the IGDB, RAWG and SteamGridDB keys, each with a
Test button. Values there win over the environment. Download clients (qBittorrent, SABnzbd,
Prowlarr) are set under **Downloads, Connections**, along with the downloads folder to import
from (games already sitting there are listed on the Downloads page, or imported automatically)
and an optional itch.io API key that lets admins add free itch.io games from **Discover, Free games**.
The **Wishlist** page links a public Steam wishlist and any RSS/Atom list feeds (under **Sources**,
admins only); they are re-checked every six hours.

### Sign in with TinyAuth

**OIDC** (recommended): open **Admin, Connections and sign-in**. Set the public address,
copy the redirect URL shown there into a new OIDC client in TinyAuth, then paste TinyAuth's
address, the client ID and secret, and press **Save and test**. A "Sign in with TinyAuth"
button appears on the login page; the desktop app supports it too. (The same settings can
come from `GM_PUBLIC_URL` and the `GM_OIDC_*` variables instead.)

**Forward auth**: if TinyAuth already guards the site through your reverse proxy, set
`GM_AUTH_HEADER_USER=remote-user` and `GM_TRUSTED_PROXIES` to your proxy's address or
network (for example `172.18.0.0/16`). Headers from anywhere else are ignored. The desktop
app and Playnite use personal tokens, so they keep working past the proxy.

## Install games (desktop app)

Open **Get the app** in the web UI and download the app for your system, enter the server
address, and sign in. Admins fill that page from **Admin, App downloads**: upload the files,
or enter the GitHub repository and press **Get latest release**. (Files live in
`/data/clients`, so copying them there works too.) On a game's page choose the drive and press **Install**. The app:

1. downloads every file (interrupted downloads resume),
2. unpacks zip, 7z and rar with 7-Zip, then deletes the archives,
3. tells the server it's installed on this PC, and tracks play time.

zip and 7z work out of the box. **RAR needs 7-Zip installed** (Windows: 7-zip.org;
Linux: `7zz`/`p7zip-full` with RAR support), because the bundled 7-Zip can't read RAR.

There is also a command-line client, `gm`, for scripting: `gm login`, `gm list`,
`gm install <id> --dest D:\Games`, `gm play`, `gm uninstall`, `gm stats`.

## Playnite

See [playnite/README.md](playnite/README.md). Create a personal token on your profile page,
paste it into the plugin settings, and the library appears in Playnite.

## Yamtrack

Yamtrack has no API for adding games, so the profile page has **Export for Yamtrack**,
a CSV of the games you've installed and played (IGDB-matched where possible). Import it
in Yamtrack under Settings, Import, Yamtrack CSV.

## Develop

Needs Node 22.

```sh
npm install
npm test              # builds everything and runs the tests
npm run dev:server    # API on :8080; set GM_GAMES_DIR and GM_DATA_DIR to local folders first
npm run dev:web       # web UI on :5173 with hot reload, proxying /api to :8080
npm run build:desktop # desktop app; then: npm run dist:win -w @lootden/desktop
```

| Folder | What's in it |
| --- | --- |
| `packages/shared` | Types and archive helpers used by everything |
| `packages/server` | Fastify API, SQLite, scanner, metadata, auth, download connectors |
| `packages/web` | React web UI (also what the desktop app shows) |
| `packages/client` | Install engine and the `gm` command-line client |
| `packages/desktop` | Electron desktop app |
| `playnite` | Playnite library plugin (C#) |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit together.

## Releases

Push a tag like `v0.2.0`. GitHub Actions then publishes the Docker image to
`ghcr.io/<you>/lootden` and attaches the Windows/Linux desktop apps, the `gm`
binaries and the Playnite plugin to a GitHub release.

## License

See [LICENSE](LICENSE) (pick a license before publishing).
