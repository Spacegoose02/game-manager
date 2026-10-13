import { randomBytes } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { json, type Db } from "../db/database.js";
import type { FetchLike } from "../metadata/http.js";

export interface NewsFeed {
  id: string;
  url: string;
  title: string;
}

export interface NewsItem {
  feedId: string;
  feedTitle: string;
  title: string;
  link: string;
  publishedAt: string | null;
  summary: string;
  image: string | null;
}

const CACHE_MS = 30 * 60_000;
const SETTINGS_KEY = "news_feeds";

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as object)) return String((v as { "#text": unknown })["#text"]);
  return "";
};
const stripHtml = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Parses RSS 2.0 and Atom into a common shape. */
export function parseFeed(xml: string, feed: NewsFeed): { title: string; items: NewsItem[] } {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" }).parse(xml);
  if (doc.rss?.channel) {
    const ch = doc.rss.channel;
    const title = feed.title || text(ch.title);
    return {
      title,
      items: arr(ch.item).map((it: Record<string, unknown>) => {
        const html = text(it["content:encoded"]) || text(it.description);
        const media = (it["media:content"] ?? it["media:thumbnail"] ?? it.enclosure) as Record<string, string> | undefined;
        const img = media?.["@url"] ?? html.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null;
        const date = text(it.pubDate);
        return {
          feedId: feed.id,
          feedTitle: title,
          title: stripHtml(text(it.title)),
          link: text(it.link),
          publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
          summary: stripHtml(html).slice(0, 300),
          image: img,
        };
      }),
    };
  }
  if (doc.feed) {
    const f = doc.feed;
    const title = feed.title || text(f.title);
    return {
      title,
      items: arr(f.entry).map((e: Record<string, unknown>) => {
        const links = arr(e.link as Record<string, string> | Array<Record<string, string>>);
        const link = links.find((l) => !l["@rel"] || l["@rel"] === "alternate")?.["@href"] ?? "";
        const html = text(e.content) || text(e.summary);
        const date = text(e.published) || text(e.updated);
        return {
          feedId: feed.id,
          feedTitle: title,
          title: stripHtml(text(e.title)),
          link,
          publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
          summary: stripHtml(html).slice(0, 300),
          image: html.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null,
        };
      }),
    };
  }
  throw new Error("Not an RSS or Atom feed");
}

/** Gaming news from feeds the admin adds. Fetched on demand and cached for 30 minutes. */
export class NewsService {
  private cache = new Map<string, { at: number; items: NewsItem[]; error: string | null }>();

  constructor(
    private readonly db: Db,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  feeds(): NewsFeed[] {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    return json<NewsFeed[]>(row?.value, []);
  }

  private save(feeds: NewsFeed[]): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(SETTINGS_KEY, JSON.stringify(feeds));
  }

  async add(url: string, title = ""): Promise<NewsFeed> {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Unknown feed address; use http or https");
    const feed: NewsFeed = { id: randomBytes(4).toString("hex"), url: parsed.toString(), title };
    // Validate now so a typo is caught when it is added, not when someone opens the news page.
    const { title: found } = parseFeed(await this.download(feed.url), feed);
    feed.title = title || found || parsed.host;
    this.save([...this.feeds(), feed]);
    return feed;
  }

  remove(id: string): void {
    this.save(this.feeds().filter((f) => f.id !== id));
    this.cache.delete(id);
  }

  private async download(url: string): Promise<string> {
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "LootDen/0.3 (+news)" } });
    if (!res.ok) throw new Error(`Feed answered ${res.status}`);
    return res.text();
  }

  async items(limit = 60): Promise<{ items: NewsItem[]; errors: Array<{ feedId: string; error: string }> }> {
    const feeds = this.feeds();
    await Promise.all(
      feeds.map(async (f) => {
        const hit = this.cache.get(f.id);
        if (hit && Date.now() - hit.at < CACHE_MS) return;
        try {
          this.cache.set(f.id, { at: Date.now(), items: parseFeed(await this.download(f.url), f).items, error: null });
        } catch (err) {
          this.cache.set(f.id, { at: Date.now(), items: hit?.items ?? [], error: (err as Error).message });
        }
      }),
    );
    const items = feeds.flatMap((f) => this.cache.get(f.id)?.items ?? []);
    items.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    const errors = feeds.flatMap((f) => (this.cache.get(f.id)?.error ? [{ feedId: f.id, error: this.cache.get(f.id)!.error! }] : []));
    return { items: items.slice(0, limit), errors };
  }
}
