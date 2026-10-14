# LootDen documentation

> **Built with AI assistance.** LootDen, and these docs, were written with a lot of help
> from an AI assistant (Anthropic's Claude), directed and reviewed by the maintainer. There
> are automated tests and it runs on the maintainer's own server, but it hasn't had an
> independent security review and some features have had little real-world testing.
> Review it before you rely on it, and keep it behind HTTPS and sign-in if it's reachable
> from the internet.

LootDen is a self-hosted library for PC games you own: a server that catalogues your
games folder, and a desktop app that installs them on your PCs.

## Getting started

1. **Run the server.** Docker Compose or `docker run`: see the [README quick
   start](../README.md#quick-start-docker). On Unraid, see [UNRAID.md](UNRAID.md).
2. **Add games.** One folder or archive per game in the games folder: see
   [LIBRARY.md](LIBRARY.md).
3. **Install the desktop app** on each PC from the server's **Get the app** page: see
   [CLIENTS.md](CLIENTS.md).
4. **Tune it.** Metadata keys, sign-in, downloads and alerts are in the web UI under
   **Settings**; environment variables are listed in [CONFIGURATION.md](CONFIGURATION.md).

## Guides

| Guide | What's in it |
| --- | --- |
| [UNRAID.md](UNRAID.md) | The Docker tab or Compose Manager, permissions, download clients |
| [LIBRARY.md](LIBRARY.md) | Folder layout, consoles, installers and disc images, the import clean-up |
| [CLIENTS.md](CLIENTS.md) | Desktop app, the `lootden` command-line client, Playnite, Yamtrack |
| [CONFIGURATION.md](CONFIGURATION.md) | Environment variables and the Settings sections |
| [UPGRADING.md](UPGRADING.md) | What to back up, how to upgrade, the rename from Game Manager |
| [FAQ.md](FAQ.md) | Common questions and troubleshooting |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the server, web UI, install engine and apps fit together |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Building from source, tests, sending changes |

## Using LootDen responsibly

You're responsible for only managing games you own or have the right to use, and for
following their licences. LootDen doesn't include or recommend any source of games; the
optional download features only talk to services you set up yourself.

## Screenshots

Screenshots for the docs live in [screenshots/](screenshots/README.md).
