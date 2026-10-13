import { randomBytes } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { json, type Db } from "../db/database.js";
import type { FetchLike } from "../metadata/http.js";

export interface VideoChannel {
  id: string;
  name: string;
}

/** A row of videos on the news and home pages, like a Glance "videos" widget. */
export interface VideoGroup {
  id: string;
  title: string;
  /** How often to re-check the channels, in minutes. */
  intervalMinutes: number;
  channels: VideoChannel[];
}

export interface Video {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  channel: string;
  publishedAt: string | null;
}

const SETTINGS_KEY = "video_groups";
const CHANNEL_ID = /^UC[\w-]{22}$/;

/** Used until an admin edits the groups: official trailer channels. */
export const DEFAULT_GROUPS: VideoGroup[] = [
  {
    id: "trailers",
    title: "Game Trailers",
    intervalMinutes: 60,
    channels: [
      { id: "UCKy1dAqELo0zrOtPkf0eTMw", name: "IGN" },
      { id: "UCjBp_7RuDBUYbd1LegWEJ8g", name: "Xbox" },
      { id: "UC-2Y8dQb0S6DtpxNgAKoJKA", name: "PlayStation" },
    ],
  },
];

const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Parses a YouTube channel's Atom feed. */
export function parseYouTubeFeed(xml: string): { channel: string; videos: Video[] } {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" }).parse(xml);
  if (!doc.feed) throw new Error("Not a YouTube feed");
  const channel = String(doc.feed.title ?? doc.feed.author?.name ?? "");
  const videos = arr(doc.feed.entry as Record<string, unknown> | Array<Record<string, unknown>>).flatMap((e) => {
    const id = String(e["yt:videoId"] ?? "");
    if (!id) return [];
    const group = e["media:group"] as Record<string, unknown> | undefined;
    const thumb = (group?.["media:thumbnail"] as Record<string, string> | undefined)?.["@url"];
    const published = String(e.published ?? "");
    return [
      {
        id,
        title: String(e.title ?? ""),
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnail: thumb ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        channel: String((e.author as Record<string, unknown> | undefined)?.name ?? channel),
        publishedAt: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
      },
    ];
  });
  // Shorts clutter a trailer row; their titles nearly always carry the tag.
  return { channel, videos: videos.filter((v) => !/#shorts\b/i.test(v.title)) };
}

/** YouTube channel rows from the channels' public feeds; no API key needed. */
export class VideoService {
  private cache = new Map<string, { at: number; videos: Video[]; error: string | null }>();

  constructor(
    private readonly db: Db,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  groups(): VideoGroup[] {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    return row ? json<VideoGroup[]>(row.value, []) : DEFAULT_GROUPS;
  }

  /**
   * Saves the groups. Channels can be given as a channel id (UC...), an @handle or a
   * channel URL; each new one is looked up so its id and name are stored.
   */
  async save(input: Array<{ id?: string; title: string; intervalMinutes?: number; channels: Array<string | VideoChannel> }>): Promise<VideoGroup[]> {
    const known = new Map(this.groups().flatMap((g) => g.channels.map((c) => [c.id, c] as const)));
    const groups: VideoGroup[] = [];
    for (const g of input) {
      const title = String(g.title ?? "").trim();
      if (!title) throw new Error("Every video row needs a title");
      const channels: VideoChannel[] = [];
      for (const c of g.channels ?? []) {
        const ref = typeof c === "string" ? c.trim() : c.id;
        if (!ref) continue;
        const channel = known.get(ref) ?? (await this.resolve(ref));
        known.set(channel.id, channel);
        if (!channels.some((x) => x.id === channel.id)) channels.push(channel);
      }
      groups.push({
        id: g.id && /^[\w-]{1,40}$/.test(g.id) ? g.id : randomBytes(4).toString("hex"),
        title,
        intervalMinutes: Math.min(Math.max(Math.round(Number(g.intervalMinutes) || 60), 15), 24 * 60),
        channels,
      });
    }
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(SETTINGS_KEY, JSON.stringify(groups));
    return groups;
  }

  /** Finds a channel's id and name from an id, @handle or youtube.com URL. */
  async resolve(ref: string): Promise<VideoChannel> {
    let id = ref.match(/(UC[\w-]{22})/)?.[1] ?? null;
    if (!id) {
      const handle = ref.match(/@([\w.-]+)/)?.[1];
      const url = handle ? `https://www.youtube.com/@${handle}` : /^https?:\/\/(www\.|m\.)?youtube\.com\//.test(ref) ? ref : null;
      if (!url) throw new Error(`"${ref}" isn't a YouTube channel id, @handle or channel link`);
      const html = await this.text(url);
      id =
        html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1] ??
        html.match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/)?.[1] ??
        null;
      if (!id) throw new Error(`Couldn't find the channel id on ${url}; paste the UC... id instead`);
    }
    if (!CHANNEL_ID.test(id)) throw new Error(`"${id}" isn't a channel id`);
    const { channel } = parseYouTubeFeed(await this.text(feedUrl(id)));
    return { id, name: channel || id };
  }

  private async text(url: string): Promise<string> {
    const res = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(15_000),
      // The consent cookie skips the EU cookie wall on channel pages.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LootDen/0.3)", "Accept-Language": "en", Cookie: "CONSENT=YES+1" },
    });
    if (!res.ok) throw new Error(`YouTube answered ${res.status} for ${url}`);
    return res.text();
  }

  private async channelVideos(c: VideoChannel, maxAgeMs: number): Promise<{ videos: Video[]; error: string | null }> {
    const hit = this.cache.get(c.id);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit;
    try {
      const fresh = { at: Date.now(), videos: parseYouTubeFeed(await this.text(feedUrl(c.id))).videos, error: null };
      this.cache.set(c.id, fresh);
      return fresh;
    } catch (err) {
      const stale = { at: Date.now(), videos: hit?.videos ?? [], error: `${c.name}: ${(err as Error).message}` };
      this.cache.set(c.id, stale);
      return stale;
    }
  }

  /** Each group's newest videos across its channels. */
  async rows(limit = 24): Promise<{ groups: Array<{ id: string; title: string; videos: Video[] }>; errors: string[] }> {
    const errors: string[] = [];
    const groups = await Promise.all(
      this.groups().map(async (g) => {
        const results = await Promise.all(g.channels.map((c) => this.channelVideos(c, g.intervalMinutes * 60_000)));
        for (const r of results) if (r.error) errors.push(r.error);
        const videos = results.flatMap((r) => r.videos);
        videos.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
        return { id: g.id, title: g.title, videos: videos.slice(0, limit) };
      }),
    );
    return { groups, errors };
  }
}

const feedUrl = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
