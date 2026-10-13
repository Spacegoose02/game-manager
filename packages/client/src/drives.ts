import { readFile, statfs } from "node:fs/promises";

export interface Drive {
  /** Root path to install under, e.g. "D:\\" or "/mnt/games". */
  path: string;
  label: string;
  freeBytes: number;
  totalBytes: number;
}

async function space(p: string): Promise<{ freeBytes: number; totalBytes: number } | null> {
  try {
    const s = await statfs(p);
    if (!s.blocks) return null;
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

const LINUX_FS = /^(ext[234]|xfs|btrfs|f2fs|ntfs3?|fuseblk|exfat|vfat|zfs|bcachefs)$/;

/** Drives the user can install games to, with free space. */
export async function listDrives(platform: NodeJS.Platform = process.platform): Promise<Drive[]> {
  const drives: Drive[] = [];
  if (platform === "win32") {
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      const root = `${letter}:\\`;
      const s = await space(root);
      if (s) drives.push({ path: root, label: `${letter}:`, ...s });
    }
    return drives;
  }
  let mounts = "";
  try {
    mounts = await readFile("/proc/mounts", "utf8");
  } catch {
    mounts = "/ / ext4 rw 0 0";
  }
  const seen = new Set<string>();
  for (const line of mounts.split("\n")) {
    const [, mountPoint = "", fsType = ""] = line.split(" ");
    const mp = mountPoint.replace(/\\040/g, " ");
    if (!LINUX_FS.test(fsType)) continue;
    if (!(mp === "/" || mp === "/home" || /^\/(mnt|media|run\/media|data|games)\//.test(mp + "/"))) continue;
    if (seen.has(mp)) continue;
    seen.add(mp);
    const s = await space(mp);
    if (s) drives.push({ path: mp, label: mp, ...s });
  }
  return drives;
}
