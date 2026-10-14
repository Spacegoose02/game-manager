import type { ReleaseInfo, ReleaseSource, SourceContext } from "../types.js";
import { isoDate } from "./util.js";

interface XrelRelease {
  id: number | string;
  dirname?: string;
  link_href?: string;
  time?: number;
  pub_time?: number;
  group_name?: string;
  group?: { id: string; name: string };
  size?: { number: number; unit: string };
  size_mb?: number;
  ext_info?: {
    id?: number;
    type?: string;
    title?: string;
    uri?: string;
  };
  flags?: Record<string, boolean>;
  nuke_reason?: string;
}

interface XrelSearchResponse {
  total?: number;
  results?: XrelRelease[];
  p2p_results?: XrelRelease[];
}

interface XrelLatestResponse {
  total_count?: number;
  pagination?: { current_page: number; per_page: number; total_pages: number };
  list?: XrelRelease[];
}

/**
 * Strips release groups, console/platform tags, versions, and scene flags
 * so game databases (IGDB/Steam) can match the clean title.
 */
function cleanSceneName(rawName: string): string {
  let name = rawName.trim();

  // 1. Remove release group at the end (-VENOM, -RUNE, -TENOKE, etc.)
  name = name.replace(/[-_][A-Za-z0-9_]+$/i, "");

  // 2. Strip platform identifiers
  name = name.replace(/\b(NSW|SWITCH|PC|WIN|LINUX|OSX|MAC|PS4|PS5|XBOX|XBOXONE|XBOX360)\b/gi, " ");

  // 3. Strip release tags and markers
  name = name.replace(
    /\b(DLC|Unlocker|Update|Repack|MULTi\d*|PROPER|REPACK|CRACK|PATCH|RIP|DELUXE|EDITION|GOTY)\b/gi,
    " "
  );

  // 4. Strip version numbers (v1.0, 1.0.2, etc.) and standalone 4-digit years
  name = name.replace(/\bv?\d+(\.\d+)+[a-z]?\b/gi, " ");
  name = name.replace(/\b(19\d\d|20[0-3]\d)\b/g, " ");

  // 5. Convert separators (underscores, dots, dashes) to spaces
  name = name.replace(/[._\-]/g, " ");

  // 6. Normalize whitespace
  return name.replace(/\s+/g, " ").trim();
}

function toRelease(item: XrelRelease, source: "scene" | "p2p"): ReleaseInfo | null {
  // If ext_info is present, ensure it's not a movie/tv/music release
  if (item.ext_info?.type && item.ext_info.type !== "master_game") {
    return null;
  }

  const rawDirname = item.dirname?.trim();
  if (!rawDirname) return null;

  // Prefer clean DB title from ext_info, otherwise clean the dirname aggressively
  const cleanedTitle = cleanSceneName(rawDirname);
  const displayTitle = item.ext_info?.title?.trim() || cleanedTitle;

  if (!displayTitle) return null;

  const isP2p = source === "p2p";
  const timestamp = (isP2p ? item.pub_time : item.time) ?? Math.floor(Date.now() / 1000);
  const dateStr = new Date(timestamp * 1000).toISOString();

  const groupName = isP2p ? item.group?.name ?? "" : item.group_name ?? "";
  const sizeMb = isP2p
    ? item.size_mb
    : item.size?.unit === "MB"
      ? item.size.number
      : undefined;

  const nukeReason = item.nuke_reason || (item.flags?.nuke_rls ? "Nuked" : undefined);

  const details: Record<string, string> = {
    Source: source,
    ReleaseName: rawDirname,
  };
  if (groupName) details["Group"] = groupName;
  if (sizeMb) details["SizeMB"] = String(sizeMb);
  if (nukeReason) details["Nuke"] = nukeReason;

  return {
    id: `xrel:${source}:${item.id}`,
    title: displayTitle,
    date: isoDate(dateStr),
    platform: "pc",
    url: item.link_href ?? null,
    image: null,
    summary: rawDirname,
    details,
  };
}

export const xrel: ReleaseSource = {
  id: "xrel",
  name: "xREL",
  description: "Tracks scene and P2P game releases from xREL.",
  defaultBaseUrl: "https://xrel-api.nfos.to",
  needsKey: false,
  limits: { perMinute: 24, perHour: 900 },

  latest: async (ctx: SourceContext): Promise<ReleaseInfo[]> => {
    const base = ctx.config.baseUrl || "https://xrel-api.nfos.to";
    const url = new URL("/v2/release/latest.json", base);
    url.searchParams.set("page", "1");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("ext_info_type", "master_game");

    const data: XrelLatestResponse = await ctx.client.json(url.toString());
    const list = data.list ?? [];

    return list
      .map((item) => toRelease(item, "scene"))
      .filter((r): r is ReleaseInfo => r !== null);
  },

  search: async (ctx: SourceContext, query: string): Promise<ReleaseInfo[]> => {
    const base = ctx.config.baseUrl || "https://xrel-api.nfos.to";
    const url = new URL("/v2/search/releases.json", base);
    url.searchParams.set("q", query.trim());
    url.searchParams.set("scene", "1");
    url.searchParams.set("p2p", "1");
    url.searchParams.set("limit", "50");

    const data: XrelSearchResponse = await ctx.client.json(url.toString());
    const scene = data.results ?? [];
    const p2p = data.p2p_results ?? [];

    const sceneReleases = scene
      .map((item) => toRelease(item, "scene"))
      .filter((r): r is ReleaseInfo => r !== null);

    const p2pReleases = p2p
      .map((item) => toRelease(item, "p2p"))
      .filter((r): r is ReleaseInfo => r !== null);

    return [...sceneReleases, ...p2pReleases];
  },
};