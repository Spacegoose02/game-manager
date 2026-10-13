# Roadmap

Everything from the original todo boards (todo and todo2), with what is built and what is next.

Status: `[x]` done, `[~]` partly done, `[ ]` not started.

## Server (Docker / Unraid)

- [x] Replace the GameVault container: one image with the API and web UI, compose file, Unraid notes
- [x] Watch folder: new or removed games show up within seconds, plus a periodic rescan as a safety net
- [x] Show server space (library size and free disk on the Admin page, `gm stats`)
- [x] Download games directly on the server: finished torrents/usenet downloads are copied or moved into the library
- [x] Release workflow: tag `v*` publishes the image to GitHub Container Registry
- [x] Client downloads hosted on the server: "Get the app" page; admins upload builds or pull the latest GitHub release
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
- [~] Yamtrack connection: CSV export that Yamtrack imports (Yamtrack has no write API yet). Automatic sync if Yamtrack adds one

## Desktop app (Windows exe, Linux AppImage/deb)

- [x] Downloads games by user choice, resumes, auto-unpacks zip / 7z / rar and removes the archives
- [x] Installs to a drive the user picks, with free space per drive
- [x] Manage installed games: play (tracks time), open folder, uninstall
- [x] Touchscreen friendly mode for the ROG Ally, controller navigation, fullscreen (F11)
- [x] `gamemanager://install/<id>` links so the browser and Playnite can hand installs to the app
- [x] Command-line client `gm` (Windows exe and Linux binary) for scripting
- [ ] Code signing for the Windows installer (unsigned builds show a SmartScreen warning)
- [ ] Auto-update from GitHub releases

## Playnite

- [x] Library plugin: imports the library, hands installs to the desktop app, reports play time back
- [ ] Publish to the Playnite add-on browser

## Look and feel

- [x] 23 themes in a picker grid, Modern and Retro groups (Wavelength, Manatee, Nord, Dracula, Tokyo Night, Synthwave '84, Terminal Green, Commodore 64, Pocket Green, Classic Desktop and more)
- [x] Featured home page with categories (continue playing, recently added, top rated, controller friendly, per genre)
- [x] Gaming raccoon logo: silhouette with mask and headset
- [x] RSS gaming news with admin-managed feeds

## Acquisition

- [x] qBittorrent: send, watch progress, pause/resume/remove
- [x] SABnzbd: send, watch progress, pause/resume/remove
- [x] Search through Prowlarr (usenet and torrent indexers, including 1337x through FlareSolverr in Prowlarr)
- [ ] Other torrent clients (Transmission, Deluge)
- [ ] Wanted list with automatic RSS grabs

The app only fetches what you point it at; it does not bundle indexers or sources.
