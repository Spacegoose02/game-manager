import { createHash } from "node:crypto";
import type { FetchLike } from "../metadata/http.js";

/** What a torrent client is handed: a magnet link, or the .torrent file LootDen fetched itself. */
export type TorrentPayload = { magnet: string; hash: string | null } | { file: Uint8Array; hash: string; name: string };

/** The 40-character hex info hash from a magnet link (hex or base32 btih), or null. */
export function magnetHash(magnet: string): string | null {
  const btih = magnet.match(/xt=urn:btih:([a-z0-9]+)/i)?.[1];
  if (!btih) return null;
  if (/^[a-f0-9]{40}$/i.test(btih)) return btih.toLowerCase();
  if (!/^[a-z2-7]{32}$/i.test(btih)) return null;
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = "";
  for (const c of btih.toLowerCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  return bits.match(/.{4}/g)!.map((b) => parseInt(b, 2).toString(16)).join("");
}

/** The info hash of a .torrent file: SHA-1 of its bencoded "info" dictionary. */
export function torrentInfoHash(buf: Uint8Array): string {
  let i = 0;
  const skip = (): void => {
    const c = buf[i]!;
    if (c === 0x69) {
      // i<digits>e
      i = buf.indexOf(0x65, i) + 1;
    } else if (c === 0x6c || c === 0x64) {
      i++;
      while (buf[i] !== 0x65) {
        if (i >= buf.length) throw new Error("Not a torrent file");
        skip();
      }
      i++;
    } else if (c >= 0x30 && c <= 0x39) {
      const colon = buf.indexOf(0x3a, i);
      const len = Number(Buffer.from(buf.subarray(i, colon)).toString());
      i = colon + 1 + len;
    } else throw new Error("Not a torrent file");
  };
  if (buf[0] !== 0x64) throw new Error("Not a torrent file");
  i = 1;
  while (i < buf.length && buf[i] !== 0x65) {
    const colon = buf.indexOf(0x3a, i);
    const len = Number(Buffer.from(buf.subarray(i, colon)).toString());
    const key = Buffer.from(buf.subarray(colon + 1, colon + 1 + len)).toString();
    i = colon + 1 + len;
    const start = i;
    skip();
    if (key === "info") return createHash("sha1").update(buf.subarray(start, i)).digest("hex");
  }
  throw new Error("The torrent file has no info section");
}

/**
 * Turns a search result's link into something every torrent client accepts. Prowlarr hands out
 * its own download links, which often redirect to a magnet or need Prowlarr to be reachable from
 * the torrent client. qBittorrent fails those silently, so LootDen follows the link itself.
 */
export async function resolveTorrent(url: string, fetchImpl: FetchLike): Promise<TorrentPayload> {
  if (url.startsWith("magnet:")) return { magnet: url, hash: magnetHash(url) };
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current, { redirect: "manual", signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "LootDen" } });
    } catch (err) {
      throw new Error(`Couldn't fetch the torrent from ${new URL(current).host}: ${(err as Error).message}. Check that Prowlarr's address under Settings is reachable from LootDen.`);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (location.startsWith("magnet:")) return { magnet: location, hash: magnetHash(location) };
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The indexer answered ${res.status} for the torrent link`);
    const file = new Uint8Array(await res.arrayBuffer());
    const head = Buffer.from(file.subarray(0, 200)).toString("latin1");
    if (head.startsWith("magnet:")) return { magnet: head.trim(), hash: magnetHash(head) };
    if (file[0] !== 0x64) {
      throw new Error(
        /<html|<!doctype/i.test(head)
          ? "The indexer sent a web page instead of a torrent (it may need a login or FlareSolverr in Prowlarr)"
          : "The indexer's link didn't return a torrent file",
      );
    }
    const name = res.headers.get("content-disposition")?.match(/filename="?([^";]+)/)?.[1] ?? "download.torrent";
    return { file, hash: torrentInfoHash(file), name };
  }
  throw new Error("The torrent link redirected too many times");
}

/** Waits for a client to list a torrent; some clients answer "Ok." and then drop bad torrents. */
export async function waitForTorrent(has: () => Promise<boolean>, tries = 10, delayMs = 1000): Promise<boolean> {
  for (let n = 0; n < tries; n++) {
    if (await has().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}
