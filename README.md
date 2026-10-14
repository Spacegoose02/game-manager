<p align="center"><img src="packages/web/public/logo.svg" width="96" alt=""></p>

# LootDen

> **Built with AI assistance.** LootDen was written with a lot of help from an AI assistant
> (Anthropic's Claude), directed and reviewed by its maintainer. It has an automated test
> suite and runs on the maintainer's own Unraid server, but it hasn't had an independent
> security review, and parts of it (the Windows installer flow, emulators, some download
> clients) have had little real-world testing. Read the code and the settings before you
> trust it with anything important. Don't expose it to the internet without a reverse
> proxy, HTTPS and sign-in in front of it.

**A raccoon's den for your loot.** LootDen is a self-hosted library for the PC games you
already own. Put your DRM-free installers and game folders on a home server; LootDen
catalogues them with covers and details, and anyone in your household can install them
on their own PC with one click, like a small private Steam.

- **Who it's for:** people with a pile of GOG, itch.io, Humble or other DRM-free games
  on a NAS or Unraid box, who want a nice way for the family to browse and install them.
- **What it isn't:** a store, a launcher for Steam/Epic games, or a way to get games you
  don't own. See [Using LootDen responsibly](#using-lootden-responsibly).

<!-- Screenshots: add images to docs/screenshots/ and link them here.
![Home](docs/screenshots/home.png)
![Game page](docs/screenshots/game.png)
![Desktop app](docs/screenshots/desktop.png)
-->

## Features

- **Library server** (Docker, made for Unraid): scans and watches your games folder, finds
  covers, descriptions, genres, age ratings and controller support (IGDB, RAWG, Steam,
  PCGamingWiki, SteamGridDB), and serves a web UI with a home page, filters, a release
  calendar, news, videos, Discover, and 23 themes.
- **Desktop app** for Windows and Linux: pick a drive, press Install. It downloads (with
  resume), unpacks zip / 7z / rar, deletes the archives, and tracks play time. Installers
  and disc images get a **Run installer** button, and an admin can upload the installed
  game so everyone after them gets a ready-to-play download.
- **Updates and DLC:** patches and DLC (in an `Updates` or `DLC` folder, or named like
  `Game Update v1.3`) get their own Updates page instead of cluttering the library. The
  desktop app applies them over the installed game with a backup, so they can be undone.
  A download named "Update" that's as big as the game is recognised as the full game.
- **Library views:** grid, compact, cover wall or list, grouped by genre, system, installed
  or A to Z, remembered per profile. The **Installed** tab lists what's ready to play with
  Play and Open folder buttons.
- **Profiles:** local accounts or single sign-on (OIDC, TinyAuth, forward auth), random
  raccoon avatars, kid profiles that only see kid-safe games, a backlog and journal per
  game, and per-profile play time.
- **Save sync:** saves are backed up to the server when you close a game and restored on
  another PC.
- **Emulation:** console games in their own section, with emulators set up by the desktop
  app and many systems playable in the browser.
- **Optional download tools** for admins: Prowlarr search, qBittorrent / Transmission /
  Deluge / SABnzbd hand-off, import clean-up, a wanted list, virus scanning and alerts.
- **Release sources:** a small plugin layer for feeds that list new games (GOG, itch.io,
  RSS, or your own), shown on Discover and used for wishlist alerts.
- **Playnite plugin** and a **command-line client** (`lootden`) for scripting.

## Quick start (Docker)

```sh
git clone https://github.com/Spacegoose02/lootden.git
cd lootden
cp .env.example .env        # set GAMES_PATH and APPDATA_PATH at least
docker compose up -d        # or: docker compose up -d --build to build it yourself
```

Open `http://<your-server>:8080`. The first visit asks you to create the admin account
(or set `LOOTDEN_ADMIN_USERNAME` and `LOOTDEN_ADMIN_PASSWORD` in `.env`).

Plain `docker run`:

```sh
docker run -d --name lootden -p 8080:8080 \
  -v /path/to/appdata/lootden:/data \
  -v /path/to/games:/games \
  ghcr.io/spacegoose02/lootden:latest
```

**On Unraid**, follow [docs/UNRAID.md](docs/UNRAID.md).

Then put your games in the games folder, **one folder or archive per game**:

```
/games/
  Stardew Valley/          <- a folder: everything inside is the game
  Hades.zip                <- a single archive is a game too
  Celeste/setup_celeste.exe + setup_celeste-1.bin   <- an installer, set up once in the app
```

More on layouts, consoles and installers: [docs/LIBRARY.md](docs/LIBRARY.md).

## Install games on your PC

1. In the web UI, open **Get the app** and download the desktop app for your system.
2. Start it, enter your server's address, and sign in.
3. Open a game and press **Install**.

RAR archives need a full 7-Zip installed (zip and 7z work out of the box). Details,
the command-line client and the Playnite plugin: [docs/CLIENTS.md](docs/CLIENTS.md).

## Documentation

| Guide | What's in it |
| --- | --- |
| [docs/README.md](docs/README.md) | Start here: an overview of all the docs |
| [docs/UNRAID.md](docs/UNRAID.md) | Running on Unraid, permissions, download clients |
| [docs/LIBRARY.md](docs/LIBRARY.md) | How to lay out games, consoles, installers and disc images |
| [docs/CLIENTS.md](docs/CLIENTS.md) | Desktop app, `lootden` CLI, Playnite, Yamtrack |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every environment variable and every Settings section |
| [docs/UPGRADING.md](docs/UPGRADING.md) | Backups, upgrades, and the rename from Game Manager |
| [docs/FAQ.md](docs/FAQ.md) | Common questions and fixes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit together |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Building, testing and sending changes |
| [ROADMAP.md](ROADMAP.md) | What's done and what's next |

## Using LootDen responsibly

LootDen manages files you put on your own server. You're responsible for only adding
games you own or otherwise have the right to use, and for following each game's licence
(many DRM-free licences allow copies for your own household; check yours). The optional
download features talk to indexers and download clients **you** configure; LootDen doesn't
include or recommend any source of games. If you expose it outside your home network,
protect it with HTTPS and sign-in.

## Project status

LootDen is a hobby project under active development (see the [changelog of
releases](https://github.com/Spacegoose02/lootden/releases)). Expect rough edges, and back
up your `appdata` folder before upgrading. Bug reports and pull requests are welcome.

## License

No licence has been chosen yet; see [LICENSE](LICENSE). Until one is added, all rights
are reserved by the author.
