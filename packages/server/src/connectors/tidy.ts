import { spawn } from "node:child_process";
import { access, constants, readdir, rename, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { groupArchiveSets, packageInfo, safeFolderName, setupKindOf } from "@lootden/shared";
import { packageTitle } from "../catalog/scanner.js";
import { cleanTitle } from "../metadata/titles.js";

export interface TidyOptions {
  /** Delete site links, NFOs, "install tutorial" folders and similar. */
  stripJunk: boolean;
  /** Unpack archives inside the download (and archives inside those). */
  extract: boolean;
  /** "zip" packs the cleaned game into "<Title> v<version>.zip"; "folder" leaves a folder with that name. */
  repack: "zip" | "folder";
}

export const DEFAULT_TIDY: TidyOptions = { stripJunk: true, extract: true, repack: "zip" };

/** Files that are always release clutter, wherever they are. */
const JUNK_ANYWHERE = /\.(url|website|lnk|webloc|nfo|sfv|diz|torrent|md5|sha1|par2)$|^(thumbs\.db|desktop\.ini|\.ds_store)$/i;
/** Clutter that only counts near the top of the release, so a game's own readme deep inside stays. */
const JUNK_TOP = /^(_*(install(ation)?[ _-]*)?(tutorial|instructions?|how[ _-]*to[ _-]*install)\b.*|read[ _-]*me.*\.(txt|html?|pdf|rtf)|.*\b[\w-]+\.(com|net|org|to|ws|cc|io|me|xyz|info|ru)\b.*\.(txt|html?|png|jpe?g|gif)|.*\b(torrents?|games?|crack(s|ed)?|repacks?)\.(com|net|org|to|ws|cc)\b.*)$/i;

export function isJunk(name: string, depth: number): boolean {
  if (JUNK_ANYWHERE.test(name)) return true;
  return depth <= 1 && JUNK_TOP.test(name);
}

/** Extracts the version from a release name: "Game.v1.2.3-GOG" -> "1.2.3", "Game Build 12345" -> "Build 12345". */
export function releaseVersion(name: string): string | null {
  const v = name.match(/(?<![a-z0-9])v(?:ersion)?[ ._]?(\d+(?:[._]\d+){0,3}[a-z]?)(?![a-z0-9])/i);
  if (v) return v[1]!.replace(/_/g, ".");
  const b = name.match(/(?<![a-z0-9])build[ ._]?(\d{3,})(?!\d)/i);
  if (b) return `Build ${b[1]}`;
  return null;
}

/** "The.Witcher.3.v4.04-GOG" -> "The Witcher 3 v4.04". */
export function tidyName(releaseName: string): string {
  const base = releaseName.replace(/(\.part\d+)?\.(zip|7z|rar|iso)(\.\d{3})?$/i, "");
  // Updates and DLC keep saying so, or they'd be taken for the full game once imported.
  const pkg = packageInfo(base);
  if (pkg.kind === "update") {
    const versions = pkg.fromVersion ? `v${pkg.fromVersion} to v${pkg.version}` : pkg.version ? `v${pkg.version}` : "";
    return safeFolderName(`${pkg.baseTitle} Update ${versions}`.trim());
  }
  if (pkg.kind === "dlc") return safeFolderName(packageTitle(base));
  const { query } = cleanTitle(base);
  const version = releaseVersion(base);
  const label = version ? (version.startsWith("Build") ? `${query} ${version}` : `${query} v${version}`) : query;
  return safeFolderName(label);
}

/**
 * Whether a 7-Zip build can unpack RAR. Some packaged builds (Debian's and Alpine's "7zip")
 * leave the RAR decoder out for licence reasons; "7z i" then lists no Rar codecs.
 */
function canUnrar(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["i"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(false));
    child.on("close", () => resolve(/\bRar5?\b/.test(out.split(/^Codecs:/m)[1] ?? "")));
  });
}

export async function findServerSevenZip(): Promise<{ path: string; rar: boolean } | null> {
  const exe = async (p: string) => access(p, constants.X_OK).then(() => true, () => false);
  if (process.env.GM_7Z_PATH && (await exe(process.env.GM_7Z_PATH))) return { path: process.env.GM_7Z_PATH, rar: await canUnrar(process.env.GM_7Z_PATH) };
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const name of ["7zz", "7z"]) if (dir && (await exe(path.join(dir, name)))) return { path: path.join(dir, name), rar: await canUnrar(path.join(dir, name)) };
  }
  try {
    const p = (createRequire(import.meta.url)("7zip-bin") as { path7za: string }).path7za;
    if (await exe(p)) return { path: p, rar: false };
  } catch {
    /* not installed: development without 7-Zip */
  }
  return null;
}

/** Where an import is: the step and how far through it (null when the step can't tell). */
export interface ImportProgress {
  stage: "copying" | "unpacking" | "cleaning" | "zipping";
  percent: number | null;
}
export type ProgressFn = (p: ImportProgress) => void;

/** Runs 7-Zip; with onPercent, reads its "-bsp1" progress output ("  42% 3 - file"). */
function run(bin: string, args: string[], cwd?: string, onPercent?: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, onPercent ? [...args.filter((a) => a !== "-bd"), "-bsp1"] : args, { cwd, stdio: ["ignore", onPercent ? "pipe" : "ignore", "pipe"] });
    let err = "";
    child.stdout?.on("data", (d: Buffer) => {
      const all = [...d.toString().matchAll(/(\d{1,3})%/g)];
      const last = all[all.length - 1];
      if (last) onPercent!(Math.min(100, Number(last[1])));
    });
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`7-Zip exited with code ${code}: ${err.trim().slice(0, 300)}`))));
  });
}

async function walk(dir: string, depth = 0, out: Array<{ path: string; name: string; depth: number; dir: boolean }> = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out.push({ path: p, name: e.name, depth, dir: e.isDirectory() });
    if (e.isDirectory()) await walk(p, depth + 1, out);
  }
  return out;
}

export interface TidyReport {
  target: string;
  removed: string[];
  extracted: string[];
  warnings: string[];
}

/**
 * Cleans a finished download sitting in `staging` (a folder only this import uses):
 * unpacks nested archives, deletes junk, unwraps a lone top folder, then either zips it
 * as "<Title> v<version>.zip" in the games folder or renames the folder to that.
 */
export async function tidyDownload(
  staging: string,
  releaseName: string,
  gamesDir: string,
  opts: TidyOptions,
  sevenZip: { path: string; rar: boolean } | null,
  onProgress: ProgressFn = () => {},
): Promise<TidyReport> {
  const report: TidyReport = { target: "", removed: [], extracted: [], warnings: [] };

  if (opts.extract) {
    if (!sevenZip) report.warnings.push("7-Zip isn't installed on the server, so archives were left packed");
    // Three rounds covers archive-in-archive releases without looping forever on a bad one.
    for (let round = 0; sevenZip && round < 3; round++) {
      const files = (await walk(staging)).filter((f) => !f.dir).map((f) => f.path);
      const sets = groupArchiveSets(files);
      if (!sets.length) break;
      let progress = false;
      for (const [i, set] of sets.entries()) {
        if (set.kind === "rar" && !sevenZip.rar) {
          report.warnings.push(`${path.basename(set.first)}: RAR needs full 7-Zip on the server`);
          continue;
        }
        try {
          // Several archives share the bar: each gets its slice of the 100%.
          onProgress({ stage: "unpacking", percent: Math.floor((i / sets.length) * 100) });
          await run(sevenZip.path, ["x", set.first, `-o${path.dirname(set.first)}`, "-y", "-bd", "-pgm-no-password"], undefined, (n) =>
            onProgress({ stage: "unpacking", percent: Math.floor(((i + n / 100) / sets.length) * 100) }),
          );
          for (const v of set.volumes) await rm(v, { force: true });
          report.extracted.push(path.relative(staging, set.first));
          progress = true;
        } catch (err) {
          report.warnings.push(`${path.basename(set.first)}: ${(err as Error).message}`);
        }
      }
      if (!progress) break;
    }
  }

  if (opts.stripJunk) {
    onProgress({ stage: "cleaning", percent: null });
    // Deepest first, so removing a junk folder never trips over its children.
    for (const f of (await walk(staging)).sort((a, b) => b.depth - a.depth)) {
      if (!isJunk(f.name, f.depth)) continue;
      await rm(f.path, { recursive: true, force: true });
      report.removed.push(path.relative(staging, f.path));
    }
  }

  // A release that is one folder ("Game/") gets its contents moved up a level.
  // Only one level: deeper single folders (like "bin/") belong to the game.
  let root = staging;
  const top = await readdir(staging, { withFileTypes: true });
  if (top.length === 1 && top[0]!.isDirectory()) root = path.join(staging, top[0]!.name);
  if ((await readdir(root)).length === 0) throw new Error("Nothing left after cleaning up the download");

  const name = tidyName(releaseName);
  // An archive the server couldn't unpack stays loose, so the PC unpacks it on install;
  // zipped up, it would come out of the zip still packed and be copied over the game as a file.
  const packed = groupArchiveSets((await walk(root)).filter((f) => !f.dir).map((f) => f.path));
  if (packed.length && opts.repack === "zip") report.warnings.push(`Kept as a folder: ${packed.map((s) => path.basename(s.first)).join(", ")} couldn't be unpacked on the server, so the PC unpacks it`);
  // Disc images and installers get set up once on a PC (see "Prepare" in the app), so keep them loose.
  const needsSetup = setupKindOf((await walk(root)).filter((f) => !f.dir).map((f) => ({ path: path.relative(root, f.path) }))) !== null;
  if (needsSetup && opts.repack === "zip") report.warnings.push("Kept as a folder: it's a disc image or installer to set up with the app first");
  if (opts.repack === "zip" && sevenZip && !needsSetup && !packed.length) {
    const target = path.join(gamesDir, `${name}.zip`);
    if (await stat(target).catch(() => null)) throw new Error(`${path.basename(target)} already exists in the games folder`);
    const temp = path.join(gamesDir, `.${name}.zip.importing`);
    await rm(temp, { force: true });
    // -mx1: games barely compress, so favour speed.
    onProgress({ stage: "zipping", percent: 0 });
    await run(sevenZip.path, ["a", "-tzip", "-mx1", "-bd", "-y", temp, "*"], root, (n) => onProgress({ stage: "zipping", percent: n }));
    await rename(temp, target);
    await rm(staging, { recursive: true, force: true });
    report.target = target;
  } else {
    if (opts.repack === "zip" && !sevenZip) report.warnings.push("7-Zip isn't installed on the server, so the game was kept as a folder");
    const target = path.join(gamesDir, name);
    if (await stat(target).catch(() => null)) throw new Error(`${name} already exists in the games folder`);
    await rename(root, target);
    if (root !== staging) await rm(staging, { recursive: true, force: true });
    report.target = target;
  }
  return report;
}

