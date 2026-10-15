import { hostSupport } from "../direct/hosts.js";
import type { ReleaseDownload } from "./types.js";

/** How a source release gets fetched: the Download Manager for file hosts, the torrent client for magnets. */
export type DownloadPlan = { via: "direct"; url: string } | { via: "torrent"; url: string };

const isTorrent = (u: string) => /^magnet:/i.test(u) || /^https?:\/\/[^\s]+\.torrent(\?|$)/i.test(u);

/** Cleans what an adapter listed: only magnet and http(s) links, empty entries dropped. */
export function cleanDownloads(list: ReleaseDownload[] | undefined): ReleaseDownload[] | undefined {
  const out = (list ?? [])
    .map((d) => ({
      title: d.title?.trim() || null,
      uris: [...new Set((d.uris ?? []).map((u) => String(u).trim()).filter((u) => /^(magnet:\?|https?:\/\/)/i.test(u)))],
      size: d.size?.trim() || null,
    }))
    .filter((d) => d.uris.length)
    .slice(0, 20);
  return out.length ? out : undefined;
}

/**
 * Picks the link to fetch. The admin may name one, but only a link the source itself listed
 * for this release, so the route can't be used to fetch arbitrary URLs. Otherwise: a file
 * host LootDen knows, then a torrent (when a torrent client is set up), then any other link
 * the generic resolver can try. Hosts that need an account (Gofile, MEGA...) are never picked.
 */
export function planDownload(downloads: ReleaseDownload[] | undefined, opts: { uri?: string | null; torrents: boolean }): DownloadPlan {
  const all = (downloads ?? []).flatMap((d) => d.uris);
  if (!all.length) throw new Error("This release has no download links");
  const plan = (url: string): DownloadPlan => (isTorrent(url) ? { via: "torrent", url } : { via: "direct", url });
  if (opts.uri) {
    if (!all.includes(opts.uri)) throw new Error("That link isn't one this release lists");
    const p = plan(opts.uri);
    if (p.via === "torrent" && !opts.torrents) throw new Error("Set up a torrent client in Settings first");
    if (p.via === "direct" && hostSupport(p.url) === "unsupported") throw new Error("LootDen can't download from that host on its own");
    return p;
  }
  const web = all.filter((u) => !isTorrent(u));
  const known = web.find((u) => hostSupport(u) === "known");
  if (known) return plan(known);
  const torrent = all.find(isTorrent);
  if (torrent && opts.torrents) return plan(torrent);
  const generic = web.find((u) => hostSupport(u) === "generic");
  if (generic) return plan(generic);
  if (torrent) throw new Error("This release only has torrent links; set up a torrent client in Settings first");
  throw new Error("This release's links are all on hosts that need an account or a browser (Gofile, MEGA, ...)");
}
