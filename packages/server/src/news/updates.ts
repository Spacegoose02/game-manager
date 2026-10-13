import type { FetchLike } from "../metadata/http.js";

export interface GameUpdate {
  title: string;
  date: string;
  url: string;
  /** Plain text with line breaks; Steam's markup is stripped. */
  body: string;
  /** Tagged as patch notes by the developer. */
  patchNotes: boolean;
}

const TTL_MS = 3 * 3600_000;

/** Steam's announcement markup ([b], [list][*], [url=...]) as readable plain text. */
export function steamMarkupToText(s: string): string {
  return s
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, "")
    .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, "")
    .replace(/\[previewyoutube[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, "")
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, "$2")
    .replace(/\s*\[\*\]\s*/g, "\n• ")
    .replace(/\[\/?(h\d|b|i|u|strike|list|olist|p|quote|code|table|tr|td|th|spoiler|noparse|hr|url)[^\]]*\]/gi, (m) => (/^\[\/?(h\d|p|list|olist|tr|hr)/i.test(m) ? "\n" : ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Latest announcements and patch notes, from Steam's public news feed (no key needed). */
export class GameUpdates {
  private cache = new Map<string, { at: number; items: GameUpdate[] }>();

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async forSteamApp(appId: string): Promise<GameUpdate[]> {
    const hit = this.cache.get(appId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(appId)}&count=15&maxlength=0&format=json`;
    const res = await this.fetchImpl(url, { headers: { "User-Agent": "LootDen" } });
    if (!res.ok) throw new Error(`Steam news answered ${res.status}`);
    const data = (await res.json()) as {
      appnews?: { newsitems?: Array<{ title: string; url: string; contents: string; date: number; feedname?: string; feed_type?: number; tags?: string[] }> };
    };
    const items = (data.appnews?.newsitems ?? [])
      // Developer posts only (feed_type 1 or the community announcements feed), not press articles about the game.
      .filter((n) => n.feed_type === 1 || n.feedname === "steam_community_announcements")
      .slice(0, 8)
      .map((n) => ({
        title: n.title,
        date: new Date(n.date * 1000).toISOString(),
        url: n.url,
        body: steamMarkupToText(n.contents).slice(0, 6000),
        patchNotes: (n.tags ?? []).includes("patchnotes") || /\b(patch|hotfix|update|changelog|v?\d+\.\d+)/i.test(n.title),
      }));
    this.cache.set(appId, { at: Date.now(), items });
    return items;
  }
}
