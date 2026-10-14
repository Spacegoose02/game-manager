import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DesktopSettings {
  serverUrl: string;
  /** Personal API token for this computer, created after the first sign-in. */
  apiToken: string;
  /** Where games go by default. */
  installDir: string;
  /** Every folder games have been installed to, so they can be found again. */
  libraryDirs: string[];
  keepArchives: boolean;
  /** Start in fullscreen "couch" mode (handhelds, TVs). */
  fullscreen: boolean;
  /** Emulators, their BIOS files and saves. Empty means the app's data folder. */
  toolsDir: string;
  /** Closing the window keeps the app in the system tray, tracking play time and installs. */
  closeToTray: boolean;
  /** Download new app versions from the server and install them when the app is idle. */
  autoUpdate: boolean;
  /** Start with the computer (in the tray). */
  openAtLogin: boolean;
  /** The "still running in the tray" hint was shown once. */
  trayHintShown: boolean;
}

export function defaultSettings(): DesktopSettings {
  const installDir = process.platform === "win32" ? "C:\\Games" : path.join(os.homedir(), "Games");
  return { serverUrl: "", apiToken: "", installDir, libraryDirs: [installDir], keepArchives: false, fullscreen: false, toolsDir: "", closeToTray: true, autoUpdate: true, openAtLogin: false, trayHintShown: false };
}

export class SettingsStore {
  private value: DesktopSettings;

  constructor(private readonly file: string) {
    try {
      this.value = { ...defaultSettings(), ...JSON.parse(readFileSync(file, "utf8")) };
    } catch {
      this.value = defaultSettings();
    }
  }

  get(): DesktopSettings {
    return { ...this.value, libraryDirs: [...this.value.libraryDirs] };
  }

  update(patch: Partial<DesktopSettings>): DesktopSettings {
    this.value = { ...this.value, ...patch };
    if (!this.value.libraryDirs.includes(this.value.installDir)) this.value.libraryDirs.push(this.value.installDir);
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.value, null, 2));
    return this.get();
  }
}
