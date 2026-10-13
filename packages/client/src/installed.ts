import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_NAME } from "./installer.js";

export interface InstalledGame {
  gameId: string;
  title: string;
  dir: string;
  installedAt: string;
  /** Executable chosen to launch the game, relative to dir, once known. */
  executable?: string;
  /** "pc", or the emulated system (played through an emulator instead of an executable). */
  platform: string;
}

async function readManifest(dir: string): Promise<InstalledGame | null> {
  try {
    const m = JSON.parse(await readFile(path.join(dir, MANIFEST_NAME), "utf8"));
    if (typeof m.gameId !== "string") return null;
    return { gameId: m.gameId, title: m.title ?? path.basename(dir), dir, installedAt: m.installedAt ?? "", executable: m.executable, platform: m.platform ?? "pc" };
  } catch {
    return null;
  }
}

/** Finds installed games by their manifest in each install folder (one level deep). */
export async function listInstalled(installDirs: string[]): Promise<InstalledGame[]> {
  const out: InstalledGame[] = [];
  const seen = new Set<string>();
  for (const root of installDirs) {
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      const m = await readManifest(path.join(root, name));
      if (m && !seen.has(m.dir)) {
        seen.add(m.dir);
        out.push(m);
      }
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Deletes an installed game folder. Refuses any folder without our manifest, so a
 * wrong path can never wipe something the app did not install.
 */
export async function uninstallGame(dir: string): Promise<InstalledGame> {
  const m = await readManifest(dir);
  if (!m) throw new Error(`${dir} is not a LootDen install (no ${MANIFEST_NAME}); not deleting it`);
  const s = await stat(dir);
  if (!s.isDirectory()) throw new Error(`${dir} is not a folder`);
  await rm(dir, { recursive: true, force: true });
  return m;
}
