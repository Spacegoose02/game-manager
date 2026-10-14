# Playing on your PCs

## Desktop app (Windows and Linux)

The desktop app shows your server's web UI and adds real **Install**, **Play** and
**Uninstall** buttons.

**Get it:** open **Get the app** in the web UI. If the page is empty, an admin fills it
from **Settings, News & apps**: press **Get latest release** (it pulls the files from
`Spacegoose02/lootden` on GitHub), upload builds by hand, or copy them into
`<appdata>/clients`.

| File | For |
| --- | --- |
| `LootDen-Setup-<version>.exe` | Windows installer |
| `LootDen-<version>-portable.exe` | Windows, no install |
| `LootDen-<version>-linux-*.AppImage` or `.deb` | Linux |

Windows may warn that the app is unsigned: choose **More info, Run anyway**.

**First start:** enter the server's address (for example `http://192.168.1.10:8080`) and
sign in. The app swaps your browser session for a token for this computer, which you can
revoke later on your profile page.

**Installing a game:** pick a drive or folder, then **Install**. The app:

1. downloads every file, resuming if interrupted,
2. unpacks zip, 7z and rar with 7-Zip and deletes the archives,
3. writes a small `.lootden.json` file into the game's folder (that's how it recognises
   its own installs, and why Uninstall only deletes folders that have one),
4. tells the server it's installed on this PC, and tracks play time when you play.

zip and 7z work out of the box. **RAR needs a full 7-Zip** (Windows: 7-zip.org; Linux:
`7zz` or `p7zip-full` with RAR support).

**No duplicate copies:** before downloading, the app looks for the game in every folder
it has installed to and in a `Games` folder on each drive. It finds copies even if the
server gave the game a new id, and offers **Use this copy** for a folder named after the
game that it didn't install itself.

**Installers:** see [LIBRARY.md](LIBRARY.md#installers-and-disc-images).

**Saves:** when a game has a save location set, the app backs up its saves to the server
after every session; restore them from the game page on another PC.

**Runs in the tray:** closing the window keeps LootDen running in the system tray, so it
keeps tracking play time and finishing installs. Click the tray icon to open it again;
right-click it for **Installed games**, app updates and **Quit LootDen**. Profile, **This
computer** has the options: close to tray, start with the computer (Windows), automatic
updates, and **Exit LootDen** to close it completely.

**App updates:** the app checks the server's **Get the app** files every few hours. When a
newer build of the same kind is there (installer, portable `.exe` or AppImage), it downloads
it and installs it when the window is closed and nothing is installing or playing, or when
you choose **Restart to update** or quit. The `.deb` can't replace itself; install new
versions of it by hand. Once an admin has pressed **Get latest release**, the server fetches
newer GitHub releases by itself twice a day, so the apps update without anyone doing
anything.

**Handhelds:** Profile, **Touch and handheld mode** makes targets bigger, and the UI
works with a controller.

## Command-line client: `lootden`

The same install engine as the desktop app, for scripts and headless machines. Download
`lootden-cli-win-x64.zip` or `lootden-cli-linux-x64.tar.gz` from **Get the app** (the 7-Zip
it needs is inside).

```sh
lootden login <username> --server http://192.168.1.10:8080
lootden list zelda
lootden install "Stardew Valley" --dest D:\Games
lootden play "Stardew Valley"
lootden installed
lootden uninstall "Stardew Valley"
lootden updates                     # updates and DLC, and which fit your installs
lootden apply "Stardew Valley v1.5 to v1.6 Patch"
lootden undo-update "Stardew Valley v1.5 to v1.6 Patch"
lootden help
```

Settings live in a config file (`lootden config path` shows where); environment
variables `LOOTDEN_SERVER`, `LOOTDEN_TOKEN`, `LOOTDEN_INSTALL_DIR`, `LOOTDEN_7Z` and
`LOOTDEN_CONFIG` override it. The older `gm` command name and `GM_` variables still work.

## Playnite

The Playnite plugin shows your LootDen library inside Playnite; **Install** hands the game
to the desktop app, and Playnite tracks play time. See
[playnite/README.md](../playnite/README.md) for building and installing it, then:

1. In LootDen, open your profile and create a token named "Playnite".
2. In Playnite, open **Add-ons, Extension settings, Libraries, LootDen**, enter the server
   address and paste the token.

Each game appears under its own platform: PC games under PC (Windows), emulated games under
Sony PlayStation, Nintendo SNES and so on, using Playnite's built-in platforms. Games imported
by an older version of the plugin are moved to the right platform on the next library update.


## Yamtrack

Your profile page has **Export for Yamtrack**: a CSV of the games you've installed and
played. Import it in Yamtrack under Settings, Import, Yamtrack CSV.
