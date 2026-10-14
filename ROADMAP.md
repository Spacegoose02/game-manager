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
- [x] 0.7: LootDen everywhere (repository, image, `LOOTDEN_` variables, `.lootden.json`, `lootden` CLI, Playnite plugin), with the old names still accepted
- [x] Random raccoon avatars with a picker on the profile page
- [x] Documentation for new users: README, docs/ guides, FAQ, contributing
- [x] RSS gaming news with admin-managed feeds
- [x] YouTube video rows (Glance-style groups of channels, e.g. Game Trailers, Game Reviews) on the News and Home pages, played in place
- [x] Fuller home page: featured hero with artwork, library rows mixed with latest news, videos and upcoming releases
- [x] Release calendar of upcoming games (IGDB, then RAWG, then Steam without keys), PC or all platforms
- [x] Discover page: search any game, see new and popular and coming soon, and (admins) find and grab downloads in one step
- [x] "Search for releases" at the top of each Discover game page
- [x] Free games tab: Epic's weekly giveaways (this week and next), Steam and GOG games at 100% off, Prime Gaming's monthly page and top free itch.io games; itch.io games can go straight into the library with an itch.io key
- [x] Reviews and Guides video row (GameSpot, Skill Up, PowerPyx) next to Game Trailers
- [x] Latest updates and patch notes on game pages, from the developer's Steam announcements
- [x] Covers shown whole in the library (blurred fill instead of cropping)
- [x] Wishlist: mirrors a public Steam wishlist, pulls games from RSS/Atom list feeds and takes games added by hand; one entry per game across sources, removals stick, "In library" once it arrives
- [x] Calendar: past releases (last month or three), your own dates (launch parties, betas), and wishlist games with a release date
- [x] "Recently added" follows each game folder's Date modified

## Acquisition

- [x] qBittorrent: send, watch progress, pause/resume/remove
- [x] SABnzbd: send, watch progress, pause/resume/remove
- [x] Search through Prowlarr (usenet and torrent indexers, including 1337x through FlareSolverr in Prowlarr)
- [x] Import progress: copying, unpacking and zipping show a percentage on the Downloads page
- [x] Downloads folder import: games already in the downloads folder are listed to import (or skip) with the same clean-up, or imported automatically
- [x] Transmission and Deluge, with the torrent fetched by LootDen and checked after adding
- [x] Wanted list: scheduled Prowlarr searches for watched wishlist games, optional auto-grab
- [x] Release rules: must / must not contain, preferred words, size, seeders, blocked indexers
- [x] "It's out" and other alerts in the web UI and through Apprise
- [x] Virus scan on import (ClamAV, optional VirusTotal), flagged imports held for review
- [x] Update detection against GOG, itch.io and Steam patch notes

The app only fetches what you point it at; it does not bundle indexers or sources.

## Emulation

- [x] Platform folders: `Emulation/<system>/` (or `roms/`), one file or folder per game, kept apart from the PC games
- [x] Emulation section with a tile per system and a shelf per system shaped like its box art (PS1, PS2, PS3, Xbox, SNES, ...)
- [x] Metadata matched on the game's own system (IGDB and RAWG platform filters)
- [x] Desktop app sets up RetroArch (with cores), DuckStation, PCSX2, RPCS3 and xemu from their official releases
- [x] BIOS files from your own consoles: picked on the PC or uploaded once to the server for every PC; PS3 firmware from Sony's page; xemu's hard drive image from the xemu project
- [x] Play emulated games from the app with play tracking; `gm emulators`, `gm bios pull` and `gm play` on the command line
- [x] Emulator saves per profile: newer saves restored before playing, changed ones backed up after (RetroArch, DuckStation, PCSX2, RPCS3)
- [x] Play in the browser with EmulatorJS (NES to PS1/PSP), sharing the in-game save with the desktop app
- [x] Downloads can be sent straight to a system's folder
- [ ] Xbox saves (they live inside xemu's hard drive image)
- [ ] Per-game PS2 memory cards (PCSX2 shares one card across games today)
- [ ] Multi-disc playlists (`.m3u`) generated automatically for PS1 and Saturn
