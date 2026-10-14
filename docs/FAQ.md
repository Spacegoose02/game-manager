# FAQ and troubleshooting

## General

**Is LootDen safe to put on the internet?**
It has sign-in, hashed passwords and tokens, and limits what each profile can see, but it
was built with AI assistance and hasn't had an independent security review. Keep it on
your home network, or put it behind a reverse proxy with HTTPS and single sign-on
(TinyAuth, Authelia, Authentik). Don't publish the port directly.

**Where do games come from?**
From your own folder. LootDen catalogues and serves what you put there. The optional
Downloads tools only talk to indexers and download clients you configure yourself; you're
responsible for only adding games you own or have the right to use.

**Does it work with Steam or Epic games?**
No. It manages DRM-free files (GOG offline installers, itch.io downloads, Humble DRM-free,
your own backups). It can read your public Steam wishlist to tell you when a wanted game
shows up in your library or a release source.

**Do players need accounts?**
Each person gets a profile (local, or via single sign-on). Kid profiles only see games
marked kid-safe. Admins can manage everything; other profiles browse, install and play.

## The server

**The container won't start: `exec: "docker-entrypoint.sh": executable file not found`.**
That was a bug in the 0.6.1 image. Update to 0.6.2 or later.

**The log says it can't write to its data folder.**
The data folder must be writable by the user the server runs as. Either start the
container normally (it fixes ownership, then runs as `PUID:PGID`, default 99:100), or, if
you use `--user 99:100`, make the folder belong to that user:
`chown -R 99:100 /mnt/user/appdata/lootden`.

**Every platform folder shows up as one big game.**
`/games` must hold one entry per game. Point it at your PC games folder, and put consoles
in an `Emulation` folder (see [LIBRARY.md](LIBRARY.md)).

**A game has the wrong cover or name.**
Open it as an admin and use **Find metadata** in the Admin panel to search again, or override the title and
artwork. Adding IGDB keys (Settings, Sign-in & services) gives much better matches.

**New games don't appear.**
They should within seconds. Some network filesystems don't report changes; the rescan
every 30 minutes catches those, or press **Rescan now** under Settings, Library.

**Where's my data?**
In the folder mounted at `/data`. Back it up before upgrading: see
[UPGRADING.md](UPGRADING.md).

## The desktop app

**Windows says the app is from an unknown publisher.**
The app isn't code-signed. Choose **More info, Run anyway**, or build it yourself.

**"This game contains RAR archives"**
Install the full 7-Zip (7-zip.org on Windows, `7zz` or `p7zip-full` on Linux). The bundled
7-Zip only reads zip and 7z.

**It asks "Which file starts this game?"**
The app couldn't guess the game's .exe, so pick it once and it's remembered. If the folder
only has `setup.exe` and data files, it's an installer: update the app and use **Run
installer**.

**I already have the game on this PC.**
The app looks for existing copies before downloading. If it finds a folder named after
the game, choose **Use this copy**. Otherwise point the install at the folder that holds it.

**Install says "Already installed in …".**
The app found this game already installed. Use **Play** or **Uninstall** on its page;
it never makes a second copy.

**My saves didn't sync.**
Saves sync for games with a save location (set on the game page by an admin), after you
close the game from the app.

## Download tools

**qBittorrent finished, but nothing was imported.**
Check Settings, Downloads, **Path mappings**: the client reports paths as *its* container
sees them, and LootDen needs to know where that is under `/downloads`. See
[UNRAID.md](UNRAID.md#downloads-qbittorrent-sabnzbd-prowlarr).

**An import is "held for review".**
The virus scanner flagged it. Look at it on the Downloads page and release or delete it.

## Reporting bugs

Open an issue on [GitHub](https://github.com/Spacegoose02/lootden/issues) with your
LootDen version (shown at `/api/health`), what you did, and the container
log. Please remove addresses, keys and tokens from logs first.
