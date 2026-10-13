# Playnite plugin

A Playnite library plugin that shows the Game Manager library inside Playnite.

- Your library is imported into Playnite, with covers, genres and release year.
- **Install** hands the game to the Game Manager desktop app (`gamemanager://install/<id>`), which downloads it to the drive you pick, unpacks zip/7z/rar and deletes the archives. Playnite marks it installed once the server confirms this PC has it. Without the desktop app, the game's web page opens instead.
- **Play** launches the game's .exe (the one the desktop app remembered, or the best guess). Playnite tracks the time and sends it to your Game Manager profile.
- **Uninstall** deletes the folder, but only if it contains the `.game-manager.json` the desktop app wrote.

## Build (Windows)

You need the .NET SDK (any recent version builds `net462`).

```powershell
cd playnite\GameManagerLibrary
dotnet build -c Release
```

Copy everything in `bin\Release\net462\` into `%AppData%\Playnite\Extensions\GameManagerLibrary\` (for the portable version, the `Extensions` folder next to `Playnite.DesktopApp.exe`), then restart Playnite.

To make an installable `.pext`, run `Toolbox.exe pack <build folder> <output folder>` from the Playnite install folder.

## Set up

1. In Game Manager, open **Profile, Devices and tokens** and create a token named "Playnite".
2. In Playnite, open **Add-ons, Extension settings, Libraries, Game Manager**. Enter the server address and paste the token.
3. Run **Update game library**.
