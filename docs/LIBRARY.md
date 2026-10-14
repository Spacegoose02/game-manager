# Your games folder

LootDen reads the folder mounted at `/games` (or `LOOTDEN_GAMES_DIR`). It never needs
anything but read access, unless you use the Downloads page, which writes imports there.

## One entry per game

Each top-level entry is one game:

```
/games/
  The Sims 4/                    <- a folder: every file inside is part of the game
    The.Sims.4.part1.rar
    The.Sims.4.part2.rar
  Grand Theft Auto V.7z          <- a single archive at the root is a game too
  Stardew Valley/
    Stardew Valley.exe
    ...
```

- Folder and archive names become titles after clean-up (`The.Sims.4.v1.98` becomes
  `The Sims 4`). An admin can override any title, cover, background or match.
- Archives, including split sets like `.part1.rar`, `.7z.001`, `.r00` and `.z01`, are
  unpacked on the player's PC after download and then deleted. Loose files are copied
  as they are.
- If your share is split by platform (`roms/pc/`, `roms/snes/`), point `/games` at the
  PC folder itself, or use the `Emulation` folder below. Otherwise each platform folder
  shows up as one big "game".
- New, renamed or removed games show up within seconds; a rescan every 30 minutes
  catches anything the folder watcher misses (some network filesystems don't report
  changes).

## Installers and disc images

Some games come as a setup program rather than a ready-to-play folder. LootDen spots these
and marks them **Installer** or **Disc image**:

- **Disc image:** an `.iso`, `.mdf`/`.mds`, `.nrg`, `.cue`/`.bin` or `.ccd` file.
- **Installer:** a `setup*.exe`, `install*.exe` or `.msi` near the top of the folder, with
  numbered data files beside it (`setup_game-1.bin`, `data1.cab`, `game-01.bin`), or with
  no other program that could be the game. GOG's offline installers are the common case.

The server checks when it scans and when it imports a download; the desktop app checks
again after unpacking, so an installer inside a zip is caught too.

What happens next:

1. A player's **Install** button says **Download installer**. After the download, the
   app shows **Run installer** instead of Play. It installs the game into an `Installed`
   folder inside the game's folder, finds the game's .exe, and offers to delete the setup
   files. From then on, **Play** starts the game.
2. An **admin** then sees **Upload installed game**. That zips the installed copy and
   puts it on the server in place of the installer (the original moves to
   `.replaced/` in the games folder). Everyone after that gets a normal, ready-to-play
   download. Admins can also use **Install here and upload** on the game page to do both
   steps at once.

Games that need setting up are listed for admins in a **Needs setting up** row on Home.
Running installers needs the Windows app; on Linux, run the installer with Wine yourself,
then use **Upload an installed folder**.

## Console games (Emulation)

Console games go in an `Emulation` folder (or `roms`), one folder per system. Every file
or folder inside a system's folder is one game, shown in the **Emulation** section:

```
/games/Emulation/
  ps1/Crash Bandicoot (USA)/Crash Bandicoot (USA).cue + .bin
  ps2/Okami (USA).iso
  ps3/Demon's Souls/PS3_GAME/USRDIR/EBOOT.BIN
  snes/Super Mario World (USA).sfc
```

System folders: `ps1` (or `psx`), `ps2`, `ps3`, `xbox`, `psp`, `nes`, `snes`, `n64`, `gb`,
`gbc`, `gba`, `nds`, `gamecube`, `wii`, `genesis` (or `megadrive`), `saturn`, `dreamcast`.

- **Desktop app:** **Emulation, Emulators and BIOS** sets up RetroArch, DuckStation,
  PCSX2, RPCS3 and xemu from their official releases. BIOS files must come from consoles
  you own: pick them on the PC, or upload them once (admins) and press **Get BIOS files
  from the server** on each PC. **Play** starts the right emulator, tracks play time and
  syncs saves.
- **Browser:** single-file games for NES, SNES, N64, Game Boy, GBA, DS, Genesis, Saturn,
  PS1 and PSP play in the browser with EmulatorJS, sharing saves with the desktop app.
  Set `LOOTDEN_EMULATORJS_DATA` to a self-hosted copy of EmulatorJS's `data/` folder to
  avoid its CDN.

## Imports from the Downloads page

If you use the optional download tools (Settings, Downloads), finished downloads are
copied or moved into `/games`. Each step can be turned off:

- junk is removed (site links, NFOs, read-mes, "install tutorial" folders),
- nested archives are unpacked,
- the result is re-zipped as `Title v1.2.zip` (installers and disc images are kept as
  folders so they can be set up),
- optionally scanned with ClamAV or VirusTotal; anything flagged is held for review.

## Wishlist, Discover and release sources

- **Wishlist:** sync a public Steam wishlist (Settings, Steam & wishlist), add RSS/Atom
  lists, or add games from Discover. Wishlist games you already own are marked.
- **Release sources:** Settings, Release sources lists feeds of new games (GOG new
  releases, itch.io new games, any RSS/Atom feed, or one you write). New entries show on
  Discover, and you get an alert when a wishlist game appears. To add your own source,
  see [packages/server/src/sources/README.md](../packages/server/src/sources/README.md).
