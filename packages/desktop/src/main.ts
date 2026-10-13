import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell, type IpcMainInvokeEvent } from "electron";
import {
  findExecutable,
  findSevenZip,
  GameServerClient,
  installGame,
  launchAndTrack,
  listDrives,
  listInstalled,
  saveExecutable,
  uninstallGame,
  type InstallEvent,
} from "@game-manager/client";
import { SettingsStore } from "./settings.js";

const PROTOCOL = "gamemanager";
let win: BrowserWindow | null = null;
let settings: SettingsStore;
const running = new Map<string, AbortController>();
let pendingDeepLink: string | null = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`)) ?? null;

if (!app.requestSingleInstanceLock()) app.quit();
app.setAsDefaultProtocolClient(PROTOCOL);

const origin = () => {
  try {
    return new URL(settings.get().serverUrl).origin;
  } catch {
    return "";
  }
};

/** IPC is only honoured from the configured server's pages (or the local setup page for setup calls). */
function fromServer(e: IpcMainInvokeEvent): void {
  const url = e.senderFrame?.url ?? "";
  if (!origin() || !url.startsWith(origin() + "/")) throw new Error("Not allowed from this page");
}

/** 7za shipped with the app: in resources/ when packaged, in vendor/ when run from source. */
function bundled7za(): string {
  const platform = process.platform === "win32" ? "win" : "linux";
  const file = process.platform === "win32" ? "7za.exe" : "7za";
  const packaged = path.join(process.resourcesPath ?? "", "7zip", platform, file);
  return app.isPackaged ? packaged : path.join(__dirname, "..", "vendor", "7zip", platform, file);
}

/** A full 7-Zip install (handles RAR) wins over the bundled 7za (zip and 7z only). */
async function sevenZipPath(): Promise<string> {
  const system = await findSevenZip("").catch(() => null);
  if (system?.supportsRar) return system.path;
  return existsSync(bundled7za()) ? bundled7za() : (system?.path ?? "");
}

/** Gets a device token from the signed-in browser session the first time it's needed. */
async function client(): Promise<GameServerClient> {
  const s = settings.get();
  if (s.apiToken) return new GameServerClient({ serverUrl: s.serverUrl, apiToken: s.apiToken });
  const [cookie] = await session.defaultSession.cookies.get({ url: s.serverUrl, name: "gm_session" });
  if (!cookie) throw new Error("Sign in first");
  const res = await net.fetch(`${origin()}/api/me/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `gm_session=${cookie.value}` },
    body: JSON.stringify({ name: `Desktop app (${os.hostname()})` }),
  });
  if (!res.ok) throw new Error(`Could not register this computer (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  settings.update({ apiToken: token });
  return new GameServerClient({ serverUrl: s.serverUrl, apiToken: token });
}

async function findInstalled(gameId: string) {
  const game = (await listInstalled(settings.get().libraryDirs)).find((g) => g.gameId === gameId);
  if (!game) throw new Error("That game is not installed on this computer");
  return game;
}

function send(payload: object): void {
  win?.webContents.send("gm:progress", payload);
}

function registerIpc(): void {
  ipcMain.handle("gm:setServer", async (e, url: string) => {
    if (!e.senderFrame?.url.startsWith("file://")) throw new Error("Not allowed from this page");
    const parsed = new URL(/^https?:\/\//.test(url) ? url : `http://${url}`);
    const health = await net.fetch(`${parsed.origin}/api/health`).then((r) => r.json() as Promise<{ status?: string }>).catch(() => null);
    if (health?.status !== "ok") throw new Error(`No Game Manager server answered at ${parsed.origin}`);
    settings.update({ serverUrl: parsed.origin, apiToken: "" });
    await win?.loadURL(parsed.origin);
    return true;
  });

  ipcMain.handle("gm:info", (e) => {
    fromServer(e);
    const s = settings.get();
    return { platform: process.platform, version: app.getVersion(), installDir: s.installDir, libraryDirs: s.libraryDirs, hostname: os.hostname(), installing: [...running.keys()] };
  });
  ipcMain.handle("gm:drives", (e) => {
    fromServer(e);
    return listDrives();
  });
  ipcMain.handle("gm:chooseFolder", async (e) => {
    fromServer(e);
    const r = await dialog.showOpenDialog(win!, { title: "Install games to", properties: ["openDirectory", "createDirectory"], defaultPath: settings.get().installDir });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("gm:setInstallDir", (e, dir: string) => {
    fromServer(e);
    return settings.update({ installDir: dir }).installDir;
  });
  ipcMain.handle("gm:installed", (e) => {
    fromServer(e);
    return listInstalled(settings.get().libraryDirs);
  });

  ipcMain.handle("gm:install", async (e, gameId: string, dir?: string) => {
    fromServer(e);
    if (running.has(gameId)) throw new Error("Already installing");
    const s = settings.get();
    const installDir = dir || s.installDir;
    if (dir) settings.update({ libraryDirs: [...new Set([...s.libraryDirs, dir])] });
    const controller = new AbortController();
    running.set(gameId, controller);
    let last = 0;
    try {
      const gameDir = await installGame(await client(), gameId, {
        installDir,
        keepArchives: s.keepArchives,
        sevenZipPath: await sevenZipPath(),
        device: os.hostname(),
        signal: controller.signal,
        onEvent: (ev: InstallEvent) => {
          if (ev.type === "download") {
            const now = Date.now();
            if (now - last < 250 && ev.received < ev.total) return;
            last = now;
          }
          send({ gameId, ...(ev.type === "start" ? { type: "start", gameDir: ev.gameDir, totalBytes: ev.game.sizeBytes } : ev) });
        },
      });
      return { gameDir };
    } catch (err) {
      send({ gameId, type: controller.signal.aborted ? "cancelled" : "error", message: (err as Error).message });
      throw err;
    } finally {
      running.delete(gameId);
    }
  });

  ipcMain.handle("gm:cancel", (e, gameId: string) => {
    fromServer(e);
    running.get(gameId)?.abort();
  });

  ipcMain.handle("gm:play", async (e, gameId: string) => {
    fromServer(e);
    const game = await findInstalled(gameId);
    let exe = game.executable ?? (await findExecutable(game.dir, game.title));
    if (!exe) {
      const r = await dialog.showOpenDialog(win!, { title: `Which file starts ${game.title}?`, defaultPath: game.dir, properties: ["openFile"] });
      if (r.canceled) return null;
      exe = path.relative(game.dir, r.filePaths[0]!);
    }
    if (exe !== game.executable) await saveExecutable(game.dir, exe);
    send({ gameId, type: "playing" });
    void launchAndTrack(game.dir, exe).then(
      async (seconds) => {
        send({ gameId, type: "stopped", seconds });
        await (await client()).reportActivity({ gameId, device: os.hostname(), event: "played", seconds });
      },
      (err: Error) => send({ gameId, type: "error", message: err.message }),
    );
    return { executable: exe };
  });

  ipcMain.handle("gm:uninstall", async (e, gameId: string) => {
    fromServer(e);
    const game = await findInstalled(gameId);
    const { response } = await dialog.showMessageBox(win!, {
      type: "warning",
      buttons: ["Delete", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: `Delete ${game.title}?`,
      detail: `This removes ${game.dir} and everything in it, including saves stored there.`,
    });
    if (response !== 0) return false;
    await uninstallGame(game.dir);
    await (await client()).reportActivity({ gameId, device: os.hostname(), event: "uninstalled" });
    return true;
  });

  ipcMain.handle("gm:openFolder", async (e, gameId: string) => {
    fromServer(e);
    await shell.openPath((await findInstalled(gameId)).dir);
  });

  ipcMain.handle("gm:changeServer", async (e) => {
    fromServer(e);
    settings.update({ serverUrl: "", apiToken: "" });
    await win?.loadFile(path.join(__dirname, "..", "setup", "index.html"));
  });

  ipcMain.handle("gm:toggleFullscreen", (e) => {
    fromServer(e);
    const full = !win?.isFullScreen();
    win?.setFullScreen(full);
    settings.update({ fullscreen: full });
    return full;
  });
}

/** gamemanager://install/<id> from a browser opens the game page with the install panel. */
async function openDeepLink(link: string): Promise<void> {
  const m = link.match(/^gamemanager:\/\/install\/([\w-]+)/);
  if (!m || !win || !origin()) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  await win.loadURL(`${origin()}/games/${m[1]}?install=1`);
}

async function createWindow(): Promise<void> {
  const s = settings.get();
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#0d0820",
    fullscreen: s.fullscreen,
    autoHideMenuBar: true,
    title: "Game Manager",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  // Links to other sites (news, screenshots) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://") || (origin() && url.startsWith(origin()))) return;
    event.preventDefault();
    if (!url.startsWith(`${origin()}/api/auth/oidc`)) void shell.openExternal(url);
  });
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "F11") win?.setFullScreen(!win.isFullScreen());
  });
  if (s.serverUrl) await win.loadURL(s.serverUrl).catch(() => win?.loadFile(path.join(__dirname, "..", "setup", "index.html")));
  else await win.loadFile(path.join(__dirname, "..", "setup", "index.html"));
  if (pendingDeepLink) {
    await openDeepLink(pendingDeepLink);
    pendingDeepLink = null;
  }
}

app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) void openDeepLink(link);
  else win?.focus();
});
app.on("open-url", (e, url) => {
  e.preventDefault();
  void openDeepLink(url);
});
app.on("window-all-closed", () => app.quit());

void app.whenReady().then(async () => {
  settings = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  registerIpc();
  await createWindow();
});
