# Backups and upgrades

## What to back up

Everything LootDen knows lives in the data folder (`/data` in the container, e.g.
`/mnt/user/appdata/lootden` on Unraid):

| Path | What it is |
| --- | --- |
| `lootden.db` (or `game-manager.db` from older versions) | Profiles, play time, journals, metadata matches, settings and keys |
| `covers/`, `backgrounds/` | Cached and uploaded artwork (fetched art comes back on its own; your uploads don't) |
| `saves/` | Save backups from the desktop app |
| `clients/` | Desktop app files for the Get the app page |

Stop the container (or copy while nothing is writing) and copy the whole folder. The
games folder is yours and isn't changed, except by imports from the Downloads page and by
**Upload installed game**, which moves the replaced installer to `.replaced/`.

## Upgrading

1. Back up the data folder.
2. Pull the new image and recreate the container: on Unraid, **Check for updates** then
   **Apply update**; with Compose, `docker compose pull && docker compose up -d`.
3. Database changes are applied automatically on start. There's no downgrade: to go back,
   restore the backup with the older image.
4. Update the desktop app from **Get the app** when a release notes it. Old apps keep
   working with a newer server; new features may need the new app.

## 0.7: Game Manager is now LootDen everywhere

LootDen was called Game Manager until v0.3, and 0.7 finishes the rename. **Nothing breaks
for existing installs**; this is what changed and what still works:

| What | New | Still works |
| --- | --- | --- |
| GitHub repository | `Spacegoose02/lootden` | Old `game-manager` links redirect |
| Docker image | `ghcr.io/spacegoose02/lootden` | The old image stops getting updates: change the Repository field to the new name |
| Environment variables | `LOOTDEN_*` | `GM_*` (if both are set, `LOOTDEN_` wins) |
| Database file | `lootden.db` for new installs | An existing `game-manager.db` keeps being used |
| Install marker in each game folder | `.lootden.json` | `.game-manager.json` is read, and replaced on the next change |
| Command-line client | `lootden` (`lootden-cli-*.zip`) | `gm` |
| App links | `lootden://` | `gamemanager://` |
| Desktop app bridge (for web UI code) | `window.lootden` | `window.gameManager` |
| Playnite plugin | `LootDenLibrary.dll` in `playnite/LootDenLibrary` | Same plugin id, so your Playnite library and settings carry over |

Things that deliberately stayed the same:

- The Windows app's internal id (`io.github.gamemanager.desktop`), so the new installer
  upgrades the existing app instead of installing a second one.
- The Playnite plugin's id. Replace the files in the existing extension folder
  (`%AppData%\Playnite\Extensions\GameManagerLibrary\`, or wherever you installed it);
  delete the old `GameManagerLibrary.dll` from it.
- Device tokens (`gmt_…`) and the `gm-<id>` tag on torrents.
- The Docker image no longer sets `GM_GAMES_DIR`, `GM_DATA_DIR` and `GM_PORT`; the server
  defaults to the same values (`/games`, `/data`, `8080`), so containers don't need any
  change. If you set any of them yourself, they keep working.

## 0.6.2: the image wouldn't start on Unraid

0.6.1's image failed with `exec: "docker-entrypoint.sh": executable file not found in
$PATH`. 0.6.2 fixes it; update the image.
