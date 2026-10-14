# Contributing

Thanks for helping. LootDen is a small hobby project, written with a lot of AI assistance
(see the note in the [README](README.md)), so careful review of changes, especially
anything touching sign-in, file paths or downloads, is very welcome.

## Build and test

Needs Node 22 (see `.nvmrc`) and, for the Playnite plugin, the .NET SDK on Windows.

```sh
npm install
npm test              # type-checks, builds the web UI and runs every test
npm run dev:server    # API on :8080; set LOOTDEN_GAMES_DIR and LOOTDEN_DATA_DIR to local folders first
npm run dev:web       # web UI on :5173 with hot reload, proxying /api to :8080
npm run build:desktop # desktop app; then: npm run dist:win -w @lootden/desktop
docker build -t lootden . && sh scripts/docker-smoke.sh lootden   # the image, started as Unraid does
```

| Folder | What's in it |
| --- | --- |
| `packages/shared` | Types and helpers used everywhere (archive sets, installer detection) |
| `packages/server` | Fastify API, SQLite, scanner, metadata, sign-in, download tools, release sources |
| `packages/web` | React web UI (also what the desktop app shows) |
| `packages/client` | Install engine and the `lootden` command-line client |
| `packages/desktop` | Electron desktop app |
| `playnite/LootDenLibrary` | Playnite library plugin (C#) |
| `brand` | Your own logos, picked up at build time |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit together.

## Sending changes

- Open an issue first for anything big, so we can agree on the approach.
- Keep pull requests focused, and add or update tests for what you change (`node:test`
  files under each package's `test/` folder).
- `npm test` must pass. CI also builds the desktop app and the Playnite plugin, and starts
  the Docker image to check it answers.
- New release sources go in `packages/server/src/sources/adapters/` (see
  `packages/server/src/sources/README.md`).

## Releases

Bump the version in every `package.json`, `package-lock.json` and
`packages/server/src/app.ts`, then push a tag like `v0.7.0`. GitHub Actions starts the
Docker image as a check, publishes it to `ghcr.io/spacegoose02/lootden`, and attaches the
desktop apps, the `lootden` CLI and the Playnite plugin to a GitHub release.
