# Running on Unraid

> **Upgrading from Game Manager?** Keep your existing container and its paths. Point the
> Repository at the new `lootden` image (or rebuild with the new source) and leave the
> `appdata` path on `/mnt/user/appdata/game-manager`: LootDen finds the old
> `game-manager.db` there and carries on. Nothing else needs changing.

## Option A: Docker tab (Add Container)

Build the image once on the server (until you publish releases, see below):

```sh
cd /mnt/user/appdata/lootden-src     # this repository, copied to the server
docker build -t lootden:latest .
```

Then **Docker, Add Container**. Example with real paths:

| Field | Value |
| --- | --- |
| Name | `lootden` |
| Repository | `lootden:latest` (or `ghcr.io/<your-github-user>/lootden:latest` once released) |
| Network | `Bridge` |
| Extra Parameters | leave empty (don't add `--user`; see below) |
| WebUI | `http://[IP]:[PORT:8080]/` |
| Port `web` | container `8080`, host `2435` (any free port) |
| Path `appdata` | container `/data`, host `/mnt/user/appdata/lootden` |
| Path `games` | container `/games`, host `/mnt/user/space/games/roms/` (see "Library folder" below) |
| Path `downloads` (optional) | container `/downloads`, host the share your download clients finish into, e.g. `/mnt/user/downloads/` |
| Variable (optional) | `PUID` / `PGID`: the user the server runs as, default `99` / `100` (nobody:users) |
| Variable (optional) | `GM_ADMIN_USERNAME` and `GM_ADMIN_PASSWORD`, or create the admin on first visit |
| Variable (optional) | `GM_IGDB_CLIENT_ID`, `GM_IGDB_CLIENT_SECRET` |
| Variable (optional) | `GM_PUBLIC_URL` and the `GM_OIDC_*` variables for TinyAuth |

Leave the `games` path Read/Write if you use the Downloads page (imports are written
there). Every variable is described in [.env.example](../.env.example).

Once a `v*` tag has been pushed, the Release workflow publishes
`ghcr.io/<your-github-user>/lootden`; make the package public (GitHub profile,
Packages, lootden, Package settings) and use that as the Repository instead.

### Permissions

The container starts as root only long enough to make the appdata folder belong to
`PUID:PGID` (99:100 by default), then runs the server as that user. Files it imports into
the games share are owned by nobody:users like the rest of Unraid.

If the log says it "can't write to its data folder", you started it with `--user`:
remove that from Extra Parameters, or run `chown -R 99:100 /mnt/user/appdata/lootden`.

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
  Proxy Manager, Traefik). TinyAuth works through OIDC or forward auth (see the README).
- Health check: `http://<unraid-ip>:8080/api/health` returns `{"status":"ok",...}`.
- The **Get the app** page serves files from `/mnt/user/appdata/lootden/clients`.
- Back up `/mnt/user/appdata/lootden`: it holds the database (profiles, play time,
  metadata matches) and the cover cache.
