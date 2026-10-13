import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp, type BuildOptions } from "../src/app.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";

/** A small library: a folder game, a split-RAR folder game, a root archive, and noise to ignore. */
export async function makeLibrary(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "gm-server-"));
  await mkdir(path.join(root, "The.Sims.4", "Data"), { recursive: true });
  await writeFile(path.join(root, "The.Sims.4", "setup.exe"), "exe");
  await writeFile(path.join(root, "The.Sims.4", "Data", "assets.bin"), "0123456789");
  await mkdir(path.join(root, "Grand Theft Auto V"));
  await writeFile(path.join(root, "Grand Theft Auto V", "gta.part1.rar"), "a");
  await writeFile(path.join(root, "Grand Theft Auto V", "gta.part2.rar"), "b");
  await writeFile(path.join(root, "Portal_2.7z"), "7z");
  await writeFile(path.join(root, "notes.txt"), "ignored: loose non-archive file");
  await mkdir(path.join(root, "Empty Folder"));
  await writeFile(path.join(root, ".DS_Store"), "");
  return root;
}

export const offlineFetch: typeof fetch = async (input) => {
  throw new Error(`Unexpected network call in test: ${String(input)}`);
};

export async function makeApp(gamesDir: string, overrides: Partial<ServerConfig> = {}, opts: BuildOptions = {}) {
  const config: ServerConfig = {
    ...loadConfig({}),
    gamesDir,
    dataDir: path.join(gamesDir, "..", `${path.basename(gamesDir)}-data`),
    logLevel: "silent",
    ...overrides,
  };
  const db = openDatabase(":memory:");
  const { app, ctx } = buildApp(config, db, { fetchImpl: offlineFetch, ...opts });
  await ctx.library.rescan();
  return { app, ctx, db, config };
}

/** Pulls the session cookie out of a response so the next request can send it back. */
export function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find((x) => x.name === "gm_session");
  if (!c) throw new Error("No session cookie set");
  return `gm_session=${c.value}`;
}
