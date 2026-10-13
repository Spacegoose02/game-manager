import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell, type IpcMainInvokeEvent } from "electron";
import {
  addBiosFile,
  biosFromServer,
  emulatorInfo,
  emulatorOverview,
  installEmulator,
  playEmulated,
  backupSaves,
  expandSavePath,
  findExecutable,
  findSevenZip,
  GameServerClient,
  installGame,
  launchAndTrack,
  listDrives,
  listInstalled,
  prepareGame,
  restoreSaves,
  uploadInstalledFolder,
  type PrepareStep,
  saveExecutable,
  uninstallGame,
  type InstallEvent,
} from "@lootden/client";
import { SettingsStore } from "./settings.js";

/** Emulators live in the app's data folder unless the user moved them. */
const toolsDir = () => settings.get().toolsDir || path.join(app.getPath("userData"), "Emulators");

// lootden:// is the current scheme; gamemanager:// still works for links and plugins from before the rename.
const PROTOCOLS = ["lootden", "gamemanager"];
const isDeepLink = (a: string) => PROTOCOLS.some((p) => a.startsWith(`${p}://`));
let win: BrowserWindow | null = null;
let settings: SettingsStore;
const running = new Map<string, AbortController>();
let pendingDeepLink: string | null = process.argv.find(isDeepLink) ?? null;

// Keep settings from before the rename: the app's data folder used to be "Game Manager".
const legacyUserData = path.join(app.getPath("appData"), "Game Manager");
if (existsSync(legacyUserData)) app.setPath("userData", legacyUserData);

if (!app.requestSingleInstanceLock()) app.quit();
for (const p of PROTOCOLS) app.setAsDefaultProtocolClient(p);

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

/** Runs an installer with a UAC prompt and waits for it (and anything it starts) to close. */
function runElevated(file: string, args: string[]): Promise<void> {
  const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
  // Inno wants /DIR="C:\a b"; NSIS wants /D=C:\a b unquoted (and last).
  const quoteArg = (a: string) => (a.includes(" ") && !a.startsWith("/D=") ? a.replace(/^([^=]+=)(.*)$/, '$1"$2"') : a);
  const argList = args.length ? ` -ArgumentList ${q(args.map(quoteArg).join(" "))}` : "";
  const script = `Start-Process -FilePath ${q(file)} -WorkingDirectory ${q(path.dirname(file))}${argList} -Verb RunAs -Wait`;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(/canceled by the user/i.test(err) ? "The installer was cancelled" : err.trim() || `Installer exited with ${code}`))));
  });
}

async function sevenZip() {
  const p = await sevenZipPath();
  if (!p) throw new Error("7-Zip is needed for save backups");
  return { path: p, supportsRar: false };
}

/** Uploads the game's saves if it has a save location and the folder exists; null otherwise. */
async function syncSaves(api: GameServerClient, gameId: string, installDir: string) {
  const detail = await api.getGame(gameId);
  if (!detail.savePath) return null;
  const dir = await expandSavePath(detail.savePath, installDir);
  if (!existsSync(dir)) return { error: `No saves found at ${dir}` };
  const backup = await backupSaves(api, await sevenZip(), gameId, dir, os.hostname());
  return { backupId: backup.id, size: backup.size };
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
    if (health?.status !== "ok") throw new Error(`No LootDen server answered at ${parsed.origin}`);
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
    if (game.platform && game.platform !== "pc") return playEmulatedGame(gameId, game.dir, game.platform);
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
        const api = await client();
        await api.reportActivity({ gameId, device: os.hostname(), event: "played", seconds });
        // Save sync: back up after every session when the game has a save location.
        const saved = await syncSaves(api, gameId, game.dir).catch((err: Error) => ({ error: err.message }));
        if (saved) send({ gameId, type: "saves", ...saved });
      },
      (err: Error) => send({ gameId, type: "error", message: err.message }),
    );
    return { executable: exe };
  });

  /** Emulated games: restore newer saves, run the emulator, back up what changed. */
  async function playEmulatedGame(gameId: string, dir: string, platform: string) {
    const api = await client();
    let started: (v: { executable: string }) => void = () => {};
    const ready = new Promise<{ executable: string }>((resolve) => (started = resolve));
    const session = playEmulated(api, gameId, dir, platform, {
      toolsDir: toolsDir(),
      sevenZip: await sevenZip(),
      device: os.hostname(),
      onEvent: (ev) => send({ gameId, type: "prepare", message: ev.message }),
      onStarted: (plan) => {
        send({ gameId, type: "playing" });
        started({ executable: `${plan.emulator.name}: ${path.basename(plan.rom)}` });
      },
    });
    session.then(
      async (r) => {
        send({ gameId, type: "stopped", seconds: r.seconds });
        await api.reportActivity({ gameId, device: os.hostname(), event: "played", seconds: r.seconds });
        if (r.backup) send({ gameId, type: "saves", backupId: r.backup.id, size: r.backup.size });
      },
      (err: Error) => send({ gameId, type: "error", message: err.message }),
    );
    // Errors before the emulator starts (missing BIOS, no emulator yet) go straight back to the page.
    return Promise.race([ready, session.then(() => ({ executable: "" }))]);
  }

  // ---- Emulators ------------------------------------------------------------------

  ipcMain.handle("gm:emulators", async (e) => {
    fromServer(e);
    return { toolsDir: toolsDir(), emulators: await emulatorOverview(toolsDir()) };
  });

  ipcMain.handle("gm:installEmulator", async (e, id: string) => {
    fromServer(e);
    const key = `emu:${id}`;
    if (running.has(key)) throw new Error("Already downloading");
    const controller = new AbortController();
    running.set(key, controller);
    let last = 0;
    try {
      return await installEmulator(id, {
        toolsDir: toolsDir(),
        sevenZip: await sevenZip(),
        signal: controller.signal,
        onEvent: (ev) => {
          const now = Date.now();
          if (ev.total && now - last < 300) return;
          last = now;
          send({ gameId: key, type: "prepare", message: ev.total ? `${ev.message} (${Math.floor(((ev.received ?? 0) / ev.total) * 100)}%)` : ev.message });
        },
      });
    } finally {
      running.delete(key);
    }
  });

  ipcMain.handle("gm:addBios", async (e, id: string) => {
    fromServer(e);
    const info = emulatorInfo(id);
    if (!info) throw new Error("Unknown emulator");
    const r = await dialog.showOpenDialog(win!, {
      title: `BIOS or firmware for ${info.name}`,
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "BIOS and firmware", extensions: ["bin", "rom0", "pup", "qcow2", "BIN", "PUP"] }, { name: "All files", extensions: ["*"] }],
    });
    if (r.canceled) return [];
    const added: string[] = [];
    for (const f of r.filePaths) added.push((await addBiosFile(toolsDir(), info, f)).label);
    return added;
  });

  ipcMain.handle("gm:biosFromServer", async (e) => {
    fromServer(e);
    return biosFromServer(await client(), toolsDir());
  });

  ipcMain.handle("gm:openTools", async (e) => {
    fromServer(e);
    await shell.openPath(toolsDir());
  });

  ipcMain.handle("gm:backupSaves", async (e, gameId: string) => {
    fromServer(e);
    const game = await findInstalled(gameId);
    const r = await syncSaves(await client(), gameId, game.dir);
    if (!r) throw new Error("No save location is set for this game yet");
    return r;
  });

  ipcMain.handle("gm:restoreSaves", async (e, gameId: string, saveId: number) => {
    fromServer(e);
    const game = await findInstalled(gameId);
    const api = await client();
    const detail = await api.getGame(gameId);
    if (!detail.savePath) throw new Error("No save location is set for this game yet");
    const dir = await expandSavePath(detail.savePath, game.dir);
    const { response } = await dialog.showMessageBox(win!, {
      type: "question",
      buttons: ["Restore", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      message: `Replace the saves in ${dir}?`,
      detail: "Your current saves are kept beside it in a .gm-backup folder.",
    });
    if (response !== 0) return null;
    return restoreSaves(api, await sevenZip(), gameId, saveId, dir);
  });

  // ---- Disc and installer games: install once here, upload the installed folder -------

  const prepareStep = (gameId: string) => {
    let last = 0;
    return (st: PrepareStep) => {
      const message =
        st.step === "download"
          ? st.event.type === "download"
            ? `Downloading ${st.event.file} (${Math.floor((st.event.received / Math.max(st.event.total, 1)) * 100)}%)`
            : st.event.type === "extract"
              ? `Unpacking ${st.event.archive}`
              : null
          : st.step === "unpack-disc"
            ? `Unpacking ${st.file}`
            : st.step === "install"
              ? "Running the installer. Finish it, then come back here."
              : st.step === "zip"
                ? "Zipping the installed game"
                : st.step === "upload"
                  ? `Uploading ${(st.bytes / 1024 ** 3).toFixed(1)} GB to the server`
                  : "Done";
      if (!message) return;
      const now = Date.now();
      if (st.step === "download" && now - last < 500) return;
      last = now;
      send({ gameId, type: "prepare", message });
    };
  };

  /** Full 7-Zip (reads ISOs) when installed, else the bundled 7za. */
  const prepSevenZip = async () => (await findSevenZip("").catch(() => null)) ?? (await sevenZip());

  ipcMain.handle("gm:prepare", async (e, gameId: string) => {
    fromServer(e);
    if (process.platform !== "win32") throw new Error("Running installers needs the Windows app. On Linux, install it with Wine yourself, then use Upload an installed folder.");
    if (running.has(gameId)) throw new Error("Already working on this game");
    const controller = new AbortController();
    running.set(gameId, controller);
    const workDir = path.join(settings.get().installDir, `.prepare-${gameId}`);
    try {
      const game = await prepareGame(await client(), gameId, {
        workDir,
        sevenZip: await prepSevenZip(),
        onStep: prepareStep(gameId),
        runInstaller: (setup, target, args) => runElevated(setup, args),
        confirmInstalled: async (suggested) => {
          const { response } = await dialog.showMessageBox(win!, {
            type: "question",
            buttons: ["Upload this folder", "Choose another folder", "Cancel"],
            defaultId: 0,
            cancelId: 2,
            message: "Is the game installed?",
            detail: `We asked the installer to use:\n${suggested}\n\nIf you picked a different folder in the installer, choose it instead. Start the game once first if it needs to finish setting up.`,
          });
          if (response === 2) return null;
          if (response === 0) return suggested;
          const r = await dialog.showOpenDialog(win!, { title: "Folder the game was installed to", properties: ["openDirectory"] });
          return r.canceled ? null : r.filePaths[0]!;
        },
      });
      send({ gameId, type: "prepare", message: game ? "Uploaded. Everyone now gets the installed version." : "Cancelled", done: true, newId: game?.id });
      return game;
    } catch (err) {
      send({ gameId, type: "prepare", message: (err as Error).message, done: true, error: true });
      throw err;
    } finally {
      running.delete(gameId);
    }
  });

  ipcMain.handle("gm:uploadFolder", async (e, gameId: string) => {
    fromServer(e);
    const r = await dialog.showOpenDialog(win!, { title: "Folder with the installed game", properties: ["openDirectory"] });
    if (r.canceled) return null;
    const workDir = path.join(settings.get().installDir, `.prepare-${gameId}`);
    try {
      const game = await uploadInstalledFolder(await client(), gameId, r.filePaths[0]!, { workDir, sevenZip: await prepSevenZip(), onStep: prepareStep(gameId) });
      send({ gameId, type: "prepare", message: "Uploaded. Everyone now gets the installed version.", done: true, newId: game.id });
      return game;
    } catch (err) {
      send({ gameId, type: "prepare", message: (err as Error).message, done: true, error: true });
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
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

/** lootden://install/<id> from a browser opens the game page with the install panel. */
async function openDeepLink(link: string): Promise<void> {
  const m = link.match(/^(?:lootden|gamemanager):\/\/install\/([\w-]+)/);
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
    title: "LootDen",
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
  const link = argv.find(isDeepLink);
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
