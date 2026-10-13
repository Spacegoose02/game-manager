import { XMLParser } from "fast-xml-parser";
import type { ReleaseInfo } from "../types.js";

const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : v && typeof v === "object" && "#text" in v ? String((v as { "#text": unknown })["#text"]) : "").trim();
const arr = <T>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

/** "2024.03.21", "Thu, 21 Mar 2024 10:00:00 GMT" or ISO -> "2024-03-21", or null. */
export function isoDate(raw: unknown): string | null {
  const s = text(raw);
  if (!s) return null;
  const dotted = s.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})/);
  if (dotted) return `${dotted[1]}-${dotted[2]}-${dotted[3]}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** Items from any RSS 2.0, RSS 1.0 or Atom feed, with dates. */
export function parseFeed(xml: string, idPrefix: string): ReleaseInfo[] {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" }).parse(xml);
  const rss = arr(doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item) as Array<Record<string, unknown>>;
  if (rss.length) {
    return rss.flatMap((i) => {
      const title = text(i.plainTitle) || text(i.title);
      if (!title) return [];
      const url = text(i.link) || text(i.guid) || null;
      const enclosure = i.enclosure as Record<string, string> | undefined;
      const thumb = (i["media:thumbnail"] ?? i["media:content"]) as Record<string, string> | undefined;
      const image = text(i.imageurl) || (enclosure?.["@type"]?.startsWith("image") ? enclosure["@url"] : thumb?.["@url"]) || text(i.description).match(/<img[^>]+src="([^"]+)"/)?.[1] || null;
      const summary = text(i.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || null;
      return [{ id: `${idPrefix}:${text(i.guid) || url || title}`, title, date: isoDate(i.pubDate ?? i["dc:date"]), platform: null, url, image, summary }];
    });
  }
  const entries = arr(doc?.feed?.entry) as Array<Record<string, unknown>>;
  return entries.flatMap((e) => {
    const title = text(e.title);
    if (!title) return [];
    const links = arr(e.link as Record<string, string> | Array<Record<string, string>>);
    const url = (links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0])?.["@href"] ?? null;
    return [{ id: `${idPrefix}:${text(e.id) || url || title}`, title, date: isoDate(e.published ?? e.updated), platform: null, url, image: null, summary: text(e.summary).slice(0, 300) || null }];
  });
}
