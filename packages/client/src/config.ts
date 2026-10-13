import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ClientConfig {
  /** Base URL of the server, e.g. http://tower.local:8080 */
  serverUrl: string;
  apiToken: string;
  /** Where games are installed; each game gets its own folder inside. Can point at any drive. */
  installDir: string;
  /** Optional path to 7z / 7z.exe / 7zz. Auto-detected when empty. */
  sevenZipPath: string;
  /** Keep archives after a successful unpack (default false = delete them). */
  keepArchives: boolean;
}

export const CONFIG_KEYS = ["serverUrl", "apiToken", "installDir", "sevenZipPath", "keepArchives"] as const;

export function configDir(): string {
  const base = process.platform === "win32" ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming") : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  // Before the rename to LootDen the folder was "game-manager"; keep using it if it's there.
  const legacy = path.join(base, "game-manager");
  return existsSync(legacy) ? legacy : path.join(base, "lootden");
}

export function configPath(): string {
  return process.env.GM_CONFIG || path.join(configDir(), "config.json");
}

export function defaults(): ClientConfig {
  return {
    serverUrl: "http://localhost:8080",
    apiToken: "",
    installDir: process.platform === "win32" ? "C:\\Games" : path.join(os.homedir(), "Games"),
    sevenZipPath: "",
    keepArchives: false,
  };
}

/** Defaults, then the config file, then environment variables. */
export async function loadConfig(): Promise<ClientConfig> {
  const config = defaults();
  try {
    Object.assign(config, JSON.parse(await readFile(configPath(), "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Could not read ${configPath()}: ${(err as Error).message}`);
  }
  if (process.env.GM_SERVER) config.serverUrl = process.env.GM_SERVER;
  if (process.env.GM_TOKEN) config.apiToken = process.env.GM_TOKEN;
  if (process.env.GM_INSTALL_DIR) config.installDir = process.env.GM_INSTALL_DIR;
  if (process.env.GM_7Z) config.sevenZipPath = process.env.GM_7Z;
  return config;
}

export async function saveConfigValue(key: string, value: string): Promise<void> {
  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Unknown setting "${key}". Valid settings: ${CONFIG_KEYS.join(", ")}`);
  }
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(await readFile(configPath(), "utf8"));
  } catch {
    current = {};
  }
  current[key] = key === "keepArchives" ? value === "true" : value;
  await mkdir(path.dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(current, null, 2) + "\n");
}
