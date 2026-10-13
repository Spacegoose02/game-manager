import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { archiveKindOf, setupKindOf, type GameFile, type GameSummary } from "@lootden/shared";

/** What the scanner knows from disk alone; the library adds database and metadata fields. */
export type ScannedGame = Pick<
  GameSummary,
  "id" | "title" | "source" | "layout" | "sizeBytes" | "fileCount" | "packed" | "needsSetup" | "modifiedAt"
> & { files: GameFile[] };

/** Files that are never part of a game (OS clutter, partial transfers). */
const IGNORED = /^(\..*|thumbs\.db|desktop\.ini|.*\.(part|crdownload|!qb|tmp|importing))$/i;

export function gameIdFor(source: string): string {
  return createHash("sha1").update(source).digest("hex").slice(0, 12);
}

/** Turns "The.Sims.4_v1.2" style names into something readable. Metadata providers will replace this later. */
export function titleFromSource(source: string, isArchive: boolean): string {
  let name = source;
  if (isArchive) name = name.replace(/(\.part\d+)?\.(zip|7z|rar)(\.\d{3})?$/i, "");
  name = name.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  return name || source;
}

async function walk(root: string, rel = ""): Promise<GameFile[]> {
  const out: GameFile[] = [];
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (IGNORED.test(entry.name)) continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walk(root, relPath)));
    } else if (entry.isFile()) {
      const s = await stat(path.join(root, relPath));
      out.push({
        index: 0,
        path: relPath,
        size: s.size,
        modifiedAt: s.mtime.toISOString(),
        archive: archiveKindOf(entry.name),
      });
    }
  }
  return out;
}

function summarize(id: string, source: string, layout: ScannedGame["layout"], files: GameFile[]): ScannedGame {
  files.forEach((f, i) => (f.index = i));
  const newest = files.reduce((max, f) => (f.modifiedAt > max ? f.modifiedAt : max), "");
  return {
    id,
    title: titleFromSource(source, layout === "archive"),
    source,
    layout,
    sizeBytes: files.reduce((sum, f) => sum + f.size, 0),
    fileCount: files.length,
    packed: files.some((f) => f.archive !== undefined),
    needsSetup: setupKindOf(files),
    modifiedAt: newest || new Date(0).toISOString(),
    files,
  };
}

/**
 * Scans the library root. Each top-level folder is one game; each top-level
 * archive file is one game. Loose non-archive files at the root are ignored.
 * Split archives at the root (Game.part1.rar, Game.part2.rar) belong in a folder.
 */
export async function scanLibrary(gamesDir: string): Promise<ScannedGame[]> {
  const entries = await readdir(gamesDir, { withFileTypes: true });
  const games: ScannedGame[] = [];
  for (const entry of entries) {
    if (IGNORED.test(entry.name)) continue;
    const full = path.join(gamesDir, entry.name);
    try {
      if (entry.isDirectory()) {
        const files = await walk(full);
        if (files.length === 0) continue;
        games.push(summarize(gameIdFor(entry.name), entry.name, "folder", files));
      } else if (entry.isFile() && archiveKindOf(entry.name)) {
        const s = await stat(full);
        games.push(
          summarize(gameIdFor(entry.name), entry.name, "archive", [
            { index: 0, path: entry.name, size: s.size, modifiedAt: s.mtime.toISOString(), archive: archiveKindOf(entry.name) },
          ]),
        );
      }
    } catch (err) {
      // One unreadable folder should not take down the whole library.
      console.warn(`Skipping ${entry.name}: ${(err as Error).message}`);
    }
  }
  return games.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

/** Absolute path of a game file on disk, refusing anything that escapes the library root. */
export function resolveGameFile(gamesDir: string, game: Pick<ScannedGame, "layout" | "source">, file: GameFile): string {
  const base = game.layout === "folder" ? path.join(gamesDir, game.source) : gamesDir;
  const full = path.resolve(base, file.path);
  const root = path.resolve(gamesDir) + path.sep;
  if (!full.startsWith(root)) throw new Error("Path escapes the games folder");
  return full;
}
