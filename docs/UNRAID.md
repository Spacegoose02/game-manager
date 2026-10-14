# Running on Unraid

> **Upgrading from Game Manager?** Keep your existing container and its paths, and change
> the Repository to `ghcr.io/spacegoose02/lootden:latest`. Leave the `appdata` path on
> `/mnt/user/appdata/game-manager`: LootDen finds the old `game-manager.db` there and
> carries on. Your `GM_` variables keep working. See [UPGRADING.md](UPGRADING.md).

## Option A: Docker tab (Add Container)

**Docker, Add Container**. Example with real paths:

| Field | Value |
| --- | --- |
| Name | `lootden` |
| Repository | `ghcr.io/spacegoose02/lootden:latest` |
| Network | `Bridge` |
| Extra Parameters | leave empty, or `--user 99:100` (see Permissions) |
| WebUI | `http://[IP]:[PORT:8080]/` |
| Port `web` | container `8080`, host `2435` (any free port) |
| Path `appdata` | container `/data`, host `/mnt/user/appdata/lootden` |
| Path `games` | container `/games`, host `/mnt/user/space/games/roms/` (see "Library folder" below) |
| Path `downloads` (optional) | container `/downloads`, host the share your download clients finish into, e.g. `/mnt/user/downloads/` |
| Variable (optional) | `PUID` / `PGID`: the user the server runs as, default `99` / `100` (nobody:users) |
| Variable (optional) | `LOOTDEN_ADMIN_USERNAME` and `LOOTDEN_ADMIN_PASSWORD`, or create the admin on first visit |
| Variable (optional) | `LOOTDEN_IGDB_CLIENT_ID`, `LOOTDEN_IGDB_CLIENT_SECRET` |
| Variable (optional) | `LOOTDEN_PUBLIC_URL` and the `LOOTDEN_OIDC_*` variables for TinyAuth |

Leave the `games` path Read/Write if you use the Downloads page (imports are written
there). Every variable is described in [CONFIGURATION.md](CONFIGURATION.md).

To build the image yourself instead, copy this repository to the server and run
`docker build -t lootden:latest .` in it, then use `lootden:latest` as the Repository.

### Permissions

The container starts as root only long enough to make the appdata folder belong to
`PUID:PGID` (99:100 by default), then runs the server as that user. Files it imports into
the games share are owned by nobody:users like the rest of Unraid.

With `--user 99:100` in Extra Parameters the container skips that step, so the appdata
folder must already belong to 99:100. If the log says it "can't write to its data
folder", remove `--user`, or run `chown -R 99:100 /mnt/user/appdata/lootden`.

### Library folder

The folder mapped to `/games` must hold **one entry per game**: each subfolder (or
single archive) directly inside it becomes one game. If the share is split by platform,
for example `roms/pc/`, `roms/snes/`, point `/games` at the PC folder itself
(`/mnt/user/space/games/roms/pc/`), otherwise every platform folder shows up as a single
"game".

## Option B: Docker Compose (Compose Manager plugin)

1. Install **Compose Manager** from Community Applications.
2. Copy this repository to the server, for example `/mnt/user/appdata/lootden-src`.
3. In that folder: `cp .env.example .env` and edit the paths and settings.
4. Add a stack in Compose Manager pointing at that folder and run **Compose Up**
   (or `docker compose up -d --build` in the terminal to build locally).

## Downloads (qBittorrent, SABnzbd, Prowlarr)

Set these up in the web UI under **Downloads, Connections**.

- Use addresses the container can reach, for example `http://192.168.1.10:8080` for
  qBittorrent (not `localhost`).
- Downloads use the `games` category in qBittorrent and SABnzbd. Create it there if it
  doesn't exist.
- **Path mappings**: qBittorrent and SABnzbd report where a download finished as *their*
  container sees it, so tell LootDen how that maps to `/downloads`. Example: if
  qBittorrent mounts `/mnt/user/downloads/` at `/data`, add `/data => /downloads`. If a
  client uses `/downloads` for the same share, it needs no mapping.
  Check each client's own Docker settings for its container path.
- **Copy** keeps torrents seeding; **Move** frees the space; **Off** leaves files alone.
- 1337x and other Cloudflare-protected sites: add FlareSolverr in Prowlarr
  (Settings, Indexers, FlareSolverr proxy) and tag those indexers with it.

## Notes

- The server runs as `99:100` (nobody:users), which matches Unraid share permissions.
- Games stream straight from disk; a cache pool is faster with many players at once.
- Keep the port on your LAN, or put it behind a reverse proxy with HTTPS (SWAG, Nginx
  Proxy Manager, Traefik). TinyAuth works through OIDC or forward auth (see [CONFIGURATION.md](CONFIGURATION.md#sign-in)).
- Health check: `http://<unraid-ip>:8080/api/health` returns `{"status":"ok",...}`.
- The **Get the app** page serves files from `/mnt/user/appdata/lootden/clients`.
- Back up `/mnt/user/appdata/lootden`: it holds the database (profiles, play time,
  metadata matches) and the cover cache.
