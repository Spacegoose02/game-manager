# Roadmap

Everything from the todo boards, with what is built and what is next. LootDen was called
Game Manager until v0.3.

Status: `[x]` done, `[~]` partly done, `[ ]` not started.

## Server (Docker / Unraid)

- [x] Replace the GameVault container: one image with the API and web UI, compose file, Unraid notes
- [x] Watch folder: new or removed games show up within seconds, plus a periodic rescan as a safety net
- [x] Show server space (library size and free disk on the Admin page, `gm stats`)
- [x] Download games directly on the server: finished torrents/usenet downloads are copied or moved into the library
- [x] Release workflow: tag `v*` publishes the image to GitHub Container Registry
- [x] Client downloads hosted on the server: "Get the app" page; admins upload builds or pull the latest GitHub release
- [x] Import clean-up: strips site links, NFOs, read-mes and "install tutorial" folders, unpacks nested archives, re-zips as `Title v1.2.zip` (each step can be turned off)
- [x] Disc images and installers: the Windows app installs the game once, zips the installed folder and uploads it in place of the ISO/installer (original kept in `.replaced/`)
- [ ] Unraid Community Applications template (XML) once the image is published

## Library and metadata

- [x] IGDB metadata (cover, summary, genres, release date, rating, age ratings), throttled under IGDB's 4 requests/second and cached
- [x] Free fallbacks without keys: Steam store and PCGamingWiki
- [x] Controller support (Steam categories, PCGamingWiki) and kid-safe flag from ESRB/PEGI/USK and other ratings
- [x] Filters: search, genre, controller support, kid-safe, sort; usable with a controller
- [x] Admin fixes: re-match against IGDB/RAWG/Steam, override title, kid-safe and controller support
- [x] Custom artwork: upload, paste a URL or pick from SteamGridDB for the cover and background
- [x] API connections set in the web UI (Admin, Connections): IGDB, RAWG, SteamGridDB, each with a Test button

## Users and access

- [x] User profiles with random gaming avatars (reroll on the profile page)
- [x] OIDC login (TinyAuth or any OIDC provider), plus TinyAuth forward-auth headers from trusted proxies
- [x] Easy TinyAuth setup in the web UI: shows the redirect URL to paste, tests the connection, no restart
- [x] Kid profiles only see kid-safe games
- [x] Game tracking per profile: installs per device, play time, last played
- [x] Save sync per profile: save backups per game (last 10 kept), automatic backup when a game closes in the app, restore on another PC, save locations suggested from PCGamingWiki
- [~] Yamtrack connection: CSV export that Yamtrack imports (Yamtrack has no write API yet). Automatic sync if Yamtrack adds one

## Desktop app (Windows exe, Linux AppImage/deb)

- [x] Downloads games by user choice, resumes, auto-unpacks zip / 7z / rar and removes the archives
- [x] Installs to a drive the user picks, with free space per drive
- [x] Manage installed games: play (tracks time), open folder, uninstall
- [x] Touchscreen friendly mode for the ROG Ally, controller navigation, fullscreen (F11)
- [x] `lootden://install/<id>` links so the browser and Playnite can hand installs to the app
- [x] Command-line client `gm` (Windows exe and Linux binary) for scripting
- [ ] Code signing for the Windows installer (unsigned builds show a SmartScreen warning)
- [ ] Auto-update from GitHub releases

## Playnite

- [x] Library plugin: imports the library, hands installs to the desktop app, reports play time back
- [ ] Publish to the Playnite add-on browser

## Look and feel

- [x] 23 themes in a picker grid, Modern and Retro groups (Wavelength, Manatee, Nord, Dracula, Tokyo Night, Synthwave '84, Terminal Green, Commodore 64, Pocket Green, Classic Desktop and more)
- [x] Featured home page with categories (continue playing, recently added, top rated, controller friendly, per genre)
- [x] Raccoon logo: a raccoon gaming on the couch (picked from five concepts)
- [x] Renamed to LootDen, keeping old data folders, settings and `gamemanager://` links working
- [x] RSS gaming news with admin-managed feeds
- [x] YouTube video rows (Glance-style groups of channels, e.g. Game Trailers, Game Reviews) on the News and Home pages, played in place
- [x] Fuller home page: featured hero with artwork, library rows mixed with latest news, videos and upcoming releases
- [x] Release calendar of upcoming games (IGDB, then RAWG, then Steam without keys), PC or all platforms
- [x] Discover page: search any game, see new and popular and coming soon, and (admins) find and grab downloads in one step

## Acquisition

- [x] qBittorrent: send, watch progress, pause/resume/remove
- [x] SABnzbd: send, watch progress, pause/resume/remove
- [x] Search through Prowlarr (usenet and torrent indexers, including 1337x through FlareSolverr in Prowlarr)
- [ ] Other torrent clients (Transmission, Deluge)
- [ ] Wanted list with automatic RSS grabs

The app only fetches what you point it at; it does not bundle indexers or sources.

## Emulation (future)

Planned, not built yet. The library already handles one entry per folder; emulation adds a
platform layer on top.

1. **Platform folders.** Treat `roms/<platform>/` subfolders (`pc`, `ps1`, `ps2`, `ps3`,
   `xbox`, `snes`, ...) as platforms. Each game gets a `platform` field; the web UI gets a
   platform switcher with a layout per system (box-art ratios, controller hints, PS1/PS2
   disc handling with `.cue/.bin`, `.chd`, `.m3u` for multi-disc). PC stays the default.
2. **Metadata per platform.** IGDB and RAWG already know platforms; matching passes the
   platform so "Ridge Racer" on PS1 doesn't match the PSP game. Libretro thumbnails and
   ScreenScraper as optional sources.
3. **Emulators in the desktop app.** Download emulator builds from their official sources
   (RetroArch with cores, DuckStation, PCSX2, RPCS3, xemu) into the app's tools folder,
   launch games with the right core/emulator and arguments, and track play time the same
   way as PC games. Users supply their own BIOS files; the app shows which ones each
   emulator needs and where to put them, and can fetch only what an emulator's project
   publishes itself.
4. **Emulator saves per profile.** Extend save sync to emulator save folders and memory
   cards (per profile, per game), with a server-side save list visible on the web, so a
   game started on the desktop continues on the ROG Ally.
5. **In-browser play (maybe).** EmulatorJS for older systems, straight from the web UI.
