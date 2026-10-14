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

// Helper to sanitize the scene directory name if a clean title isn't available
function cleanSceneName(rawName: string): string {
  return rawName
    .replace(/-[A-Za-z0-9_]+$/, "") // Remove release group
    .replace(/[_.]?(DLC|Unlocker|NSW|SWITCH|MULTI\d*|v\d+(\.\d+)*)[_.]?/gi, " ") // Remove tags
    .replace(/[._]/g, " ") // Replace dots and underscores
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim();
}

function toRelease(item: XrelRelease, source: "scene" | "p2p"): ReleaseInfo | null {
  // Only process master_game entries
  if (item.ext_info?.type !== "master_game") {
    return null;
  }

  const rawDirname = item.dirname?.trim();
  if (!rawDirname) return null;

  // Use xREL's clean game title if available, otherwise sanitize the dirname
  const displayTitle = item.ext_info?.title?.trim() || cleanSceneName(rawDirname);

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
    ReleaseName: rawDirname, // Preserve exact folder name
  };
  if (groupName) details["Group"] = groupName;
  if (sizeMb) details["SizeMB"] = String(sizeMb);
  if (nukeReason) details["Nuke"] = nukeReason;

  return {
    id: `xrel:${source}:${item.id}`,
    title: displayTitle, // Search engine now uses the clean title
    date: isoDate(dateStr),
    platform: "pc",
    url: item.link_href ?? null,
    image: null,
    summary: rawDirname, // Shows the scene string in the UI summary
    details,
  };
}

export const xrel: ReleaseSource = {
  id: "xrel",
  name: "xREL",
  description: "Tracks scene and P2P game releases from xREL.",
  defaultBaseUrl: "https://xrel-api.nfos.to",
  needsKey: false,
  // xREL enforces 900 calls/hour and search max 2 calls per 5 seconds (~24/min)
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