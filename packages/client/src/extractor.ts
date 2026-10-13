import { spawn } from "node:child_process";
import { access, chmod, constants } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { ArchiveKind } from "@lootden/shared";

export interface SevenZip {
  path: string;
  /** The bundled 7za handles zip and 7z but not rar; a full 7-Zip install handles all three. */
  supportsRar: boolean;
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function onPath(name: string): Promise<string | null> {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function bundled7za(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return (require("7zip-bin") as { path7za: string }).path7za;
  } catch {
    return null;
  }
}

/** Finds 7-Zip: configured path, a normal install, PATH, 7za beside a packaged exe, then the npm-bundled 7za. */
export async function findSevenZip(configured: string): Promise<SevenZip | null> {
  if (configured) {
    if (!(await isExecutable(configured))) throw new Error(`7-Zip not found at configured path ${configured}`);
    return { path: configured, supportsRar: !/7za(\.exe)?$/i.test(configured) };
  }
  const installed =
    process.platform === "win32"
      ? [
          path.join(process.env.ProgramFiles || "C:\\Program Files", "7-Zip", "7z.exe"),
          path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "7-Zip", "7z.exe"),
        ]
      : [];
  for (const candidate of installed) {
    if (await isExecutable(candidate)) return { path: candidate, supportsRar: true };
  }
  for (const name of ["7zz", "7z"]) {
    const found = await onPath(name);
    if (found) return { path: found, supportsRar: true };
  }
  // Packaged releases ship 7za next to the executable.
  const beside = path.join(path.dirname(process.execPath), process.platform === "win32" ? "7za.exe" : "7za");
  if (await isExecutable(beside)) return { path: beside, supportsRar: false };
  const fallback = bundled7za();
  if (fallback) {
    // npm sometimes installs the bundled Linux binary without its execute bit.
    if (process.platform !== "win32" && !(await isExecutable(fallback))) await chmod(fallback, 0o755).catch(() => {});
    if (await isExecutable(fallback)) return { path: fallback, supportsRar: false };
  }
  return null;
}

/** Extracts an archive (first volume for split sets) into outDir, overwriting existing files. */
export function extractArchive(sevenZip: SevenZip, kind: ArchiveKind, archivePath: string, outDir: string): Promise<void> {
  if (kind === "rar" && !sevenZip.supportsRar) {
    return Promise.reject(
      new Error("RAR archives need a full 7-Zip install (7-zip.org on Windows, the 7zip or p7zip-full package on Linux)."),
    );
  }
  return new Promise((resolve, reject) => {
    // A dummy password makes encrypted archives fail fast instead of waiting on a prompt.
    const args = ["x", archivePath, `-o${outDir}`, "-y", "-bd", "-pgm-no-password"];
    const child = spawn(sevenZip.path, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`7-Zip exited with code ${code} on ${path.basename(archivePath)}: ${stderr.trim() || "no details"}`));
    });
  });
}
