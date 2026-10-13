import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { XMLParser } from "fast-xml-parser";
import { safeFolderName } from "@lootden/shared";
import type { FetchLike } from "../metadata/http.js";
import { parseSteamSearch } from "../metadata/calendar.js";

export type FreeStore = "epic" | "steam" | "gog" | "itch" | "prime";

export interface FreeGame {
  store: FreeStore;
  title: string;
  url: string;
  image: string | null;
  /** Limited-time giveaways end; always-free games don't. */
  endsAt: string | null;
  /** Announced but not claimable yet (Epic shows next week's games). */
  startsAt: string | null;
  upcoming: boolean;
  /** "giveaway": normally paid, free for a while. "free": free to keep any time. */
  kind: "giveaway" | "free";
  /** itch.io games LootDen can download straight into the library (needs the itch.io key). */
  canAdd: boolean;
}

export interface FreeGamesResult {
  games: FreeGame[];
  errors: Array<{ store: FreeStore; message: string }>;
  itchConnected: boolean;
}

const TTL_MS = 3 * 3600_000;
const UA = { "User-Agent": "Mozilla/5.0 (LootDen)" };

/** Prime Gaming has no public list, so it's a link to the monthly page. */
const PRIME: FreeGame = {
  store: "prime",
  title: "Prime Gaming: this month's free games",
  url: "https://gaming.amazon.com/home",
  image: null,
  endsAt: null,
  startsAt: null,
  upcoming: false,
  kind: "giveaway",
  canAdd: false,
};

interface EpicElement {
  title: string;
  productSlug?: string | null;
  urlSlug?: string;
  catalogNs?: { mappings?: Array<{ pageSlug: string; pageType?: string }> | null };
  offerMappings?: Array<{ pageSlug: string; pageType?: string }> | null;
  keyImages?: Array<{ type: string; url: string }>;
  price?: { totalPrice?: { discountPrice?: number; originalPrice?: number } };
  promotions?: {
    promotionalOffers?: Array<{ promotionalOffers: Array<{ startDate: string; endDate: string; discountSetting?: { discountPercentage?: number } }> }>;
    upcomingPromotionalOffers?: Array<{ promotionalOffers: Array<{ startDate: string; endDate: string; discountSetting?: { discountPercentage?: number } }> }>;
  } | null;
}

/** Epic's weekly free games, current and next, from the store's own promotions feed. */
export function parseEpic(data: unknown): FreeGame[] {
  const elements = ((data as { data?: { Catalog?: { searchStore?: { elements?: EpicElement[] } } } }).data?.Catalog?.searchStore?.elements ?? []) as EpicElement[];
  const out: FreeGame[] = [];
  for (const e of elements) {
    const now = (e.promotions?.promotionalOffers ?? []).flatMap((p) => p.promotionalOffers).find((o) => o.discountSetting?.discountPercentage === 0);
    const next = (e.promotions?.upcomingPromotionalOffers ?? []).flatMap((p) => p.promotionalOffers).find((o) => o.discountSetting?.discountPercentage === 0);
    const offer = now ?? next;
    if (!offer) continue;
    // A current offer only counts while the price is really zero.
    if (now && e.price?.totalPrice?.discountPrice !== undefined && e.price.totalPrice.discountPrice !== 0) continue;
    const slug = e.catalogNs?.mappings?.find((m) => m.pageSlug)?.pageSlug ?? e.offerMappings?.find((m) => m.pageSlug)?.pageSlug ?? e.productSlug ?? e.urlSlug;
    const img = (t: string) => e.keyImages?.find((k) => k.type === t)?.url;
    out.push({
      store: "epic",
      title: e.title,
      url: slug ? `https://store.epicgames.com/en-US/p/${slug.replace(/\/home$/, "")}` : "https://store.epicgames.com/en-US/free-games",
      image: img("OfferImageWide") ?? img("DieselStoreFrontWide") ?? img("Thumbnail") ?? img("OfferImageTall") ?? null,
      endsAt: offer.endDate ?? null,
      startsAt: offer.startDate ?? null,
      upcoming: !now,
      kind: "giveaway",
      canAdd: false,
    });
  }
  return out;
}

/** GOG games that are normally paid but free right now (demos and always-free games are left out). */
export function parseGog(data: unknown): FreeGame[] {
  const products = ((data as { products?: unknown[] }).products ?? []) as Array<{
    title: string;
    storeLink?: string;
    slug?: string;
    coverHorizontal?: string;
    tags?: string[];
    price?: { finalMoney?: { amount?: string }; baseMoney?: { amount?: string } };
  }>;
  return products
    .filter((p) => Number(p.price?.finalMoney?.amount ?? 1) === 0 && Number(p.price?.baseMoney?.amount ?? 0) > 0)
    .filter((p) => !(p.tags ?? []).some((t) => /^demo\b/i.test(t)) && !/\bdemo\b/i.test(p.title))
    .map((p) => ({
      store: "gog" as const,
      title: p.title,
      url: p.storeLink ?? `https://www.gog.com/en/game/${p.slug}`,
      image: p.coverHorizontal ?? null,
      endsAt: null,
      startsAt: null,
      upcoming: false,
      kind: "giveaway" as const,
      canAdd: false,
    }));
}

/** itch.io's top-rated free games feed (RSS). */
export function parseItchFeed(xml: string, canAdd: boolean): FreeGame[] {
  const doc = new XMLParser().parse(xml);
  const items = doc?.rss?.channel?.item;
  const list = (Array.isArray(items) ? items : items ? [items] : []) as Array<Record<string, unknown>>;
  return list
    .filter((i) => /windows|linux/i.test(String(i.title ?? "")))
    .slice(0, 30)
    .map((i) => ({
      store: "itch" as const,
      title: String(i.plainTitle ?? i.title ?? "").trim(),
      url: String(i.link ?? i.guid ?? ""),
      image: i.imageurl ? String(i.imageurl) : null,
      endsAt: null,
      startsAt: null,
      upcoming: false,
      kind: "free" as const,
      canAdd,
    }));
}

/**
 * Free games to claim, from each store's own public listings: Epic's weekly giveaways,
 * Steam and GOG games that are 100% off, itch.io's top free games and a Prime Gaming link.
 * Claiming happens on the store with the player's account; itch.io games can also be
 * downloaded into the library when an itch.io key is set.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ItchUpload {
  id: number;
  filename: string;
  display_name?: string;
  size?: number;
  type?: string;
  demo?: boolean;
  /** Older API answers. */
  p_windows?: boolean;
  p_linux?: boolean;
  p_osx?: boolean;
  p_android?: boolean;
  /** Current API answers: "p_windows", "p_linux", "p_osx", "p_android", "demo". */
  traits?: string[];
  min_price?: number;
  updated_at?: string;
}

/**
 * The Windows (else Linux) download among a game's uploads. Platforms come from the API's
 * flags or traits, and, for uploads nobody tagged, from the file name. Says why when none fits.
 */
export function pickItchUpload(uploads: ItchUpload[]): { upload: ItchUpload | null; why: string } {
  const has = (u: ItchUpload, t: string) => u[t as "p_windows"] === true || !!u.traits?.includes(t);
  const name = (u: ItchUpload) => `${u.display_name ?? ""} ${u.filename}`.toLowerCase();
  const guess = (u: ItchUpload) =>
    /\.(exe|msi)$|\bwin(dows|32|64)?\b|\bpc\b/.test(name(u)) ? "win" : /\.(appimage|sh|deb|rpm|x86_64)$|\blinux\b|\.tar\.(gz|xz|bz2)$/.test(name(u)) ? "linux" : /\b(mac|osx|macos)\b|\.(dmg|pkg)$/.test(name(u)) ? "mac" : /\.apk$|\bandroid\b/.test(name(u)) ? "android" : null;
  const files = uploads.filter((u) => !["html", "soundtrack", "book", "video", "documentation", "mod", "audio_assets", "graphical_assets", "sourcecode"].includes(u.type ?? "default"));
  const full = files.filter((u) => !u.demo && !has(u, "demo"));
  const pool = full.length ? full : files;
  const pick =
    pool.find((u) => has(u, "p_windows")) ??
    pool.find((u) => has(u, "p_linux")) ??
    pool.find((u) => !has(u, "p_osx") && !has(u, "p_android") && guess(u) === "win") ??
    pool.find((u) => !has(u, "p_osx") && !has(u, "p_android") && guess(u) === "linux") ??
    // One untagged archive with no other platform hints is usually the game.
    pool.filter((u) => !["p_osx", "p_android", "p_windows", "p_linux"].some((t) => has(u, t)) && !guess(u) && /\.(zip|7z|rar)$/i.test(u.filename)).find((_, __, all) => all.length === 1) ??
    null;
  if (pick) return { upload: pick, why: "" };
  if (!uploads.length)
    return { upload: null, why: "itch.io gave LootDen no downloads for this game. Paid games, and some pay-what-you-want ones, only list files for accounts that own them; use Download on itch.io and drop the file in the downloads folder" };
  if (uploads.every((u) => u.type === "html")) return { upload: null, why: "This game is browser-only on itch.io; there's nothing to download" };
  const others = [...new Set(uploads.flatMap((u) => (has(u, "p_osx") || guess(u) === "mac" ? ["Mac"] : has(u, "p_android") || guess(u) === "android" ? ["Android"] : [])))];
  return { upload: null, why: others.length ? `This game only has ${others.join(" and ")} downloads on itch.io` : "This game has no Windows or Linux download on itch.io" };
}

export class FreeGames {
  private cache: { at: number; result: FreeGamesResult } | null = null;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly itchKey: () => string,
  ) {}

  reset(): void {
    this.cache = null;
  }

  async list(): Promise<FreeGamesResult> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return { ...this.cache.result, itchConnected: Boolean(this.itchKey()) };
    const errors: FreeGamesResult["errors"] = [];
    const get = async (store: FreeStore, fn: () => Promise<FreeGame[]>) => {
      try {
        return await fn();
      } catch (err) {
        errors.push({ store, message: (err as Error).message });
        return [];
      }
    };
    const json = async (url: string) => {
      const res = await this.fetchImpl(url, { headers: UA });
      if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
      return res.json();
    };
    const [epic, steam, gog, itch] = await Promise.all([
      get("epic", async () => parseEpic(await json("https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US"))),
      get("steam", async () => {
        const params = new URLSearchParams({ maxprice: "free", specials: "1", category1: "998", count: "50", start: "0", infinite: "1", cc: "us", l: "english" });
        const r = (await json(`https://store.steampowered.com/search/results/?${params}`)) as { results_html?: string };
        return parseSteamSearch(r.results_html ?? "").map((x) => ({
          store: "steam" as const,
          title: x.name,
          url: `https://store.steampowered.com/app/${x.appId}/`,
          image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${x.appId}/header.jpg`,
          endsAt: null,
          startsAt: null,
          upcoming: false,
          kind: "giveaway" as const,
          canAdd: false,
        }));
      }),
      get("gog", async () => parseGog(await json("https://catalog.gog.com/v1/catalog?limit=48&price=between:0,0&discounted=eq:true&order=desc:trending&productType=in:game,pack"))),
      get("itch", async () => {
        const res = await this.itchFetch("https://itch.io/games/top-rated/free.xml");
        if (!res.ok) throw new Error(`itch.io answered ${res.status}`);
        return parseItchFeed(await res.text(), true);
      }),
    ]);
    const result: FreeGamesResult = { games: [...epic, ...steam, ...gog, PRIME, ...itch], errors, itchConnected: Boolean(this.itchKey()) };
    this.cache = { at: Date.now(), result };
    return result;
  }

  /**
   * itch.io rate-limits bursts (429), so its requests go one at a time with a gap between
   * them, and a 429 is retried after the wait itch.io asks for (or 2, 4, 8 seconds).
   */
  private itchQueue: Promise<unknown> = Promise.resolve();
  private itchLast = 0;
  private itchIds = new Map<string, { gameId: string; title: string }>();

  private itchFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const gap = Number(process.env.GM_ITCH_GAP_MS ?? 1000);
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = this.itchLast + gap - Date.now();
        if (wait > 0) await sleep(wait);
        this.itchLast = Date.now();
        const res = await this.fetchImpl(url, { ...init, headers: { ...UA, ...(init.headers as Record<string, string>) } });
        if (res.status !== 429 || attempt >= 3) {
          if (res.status === 429) throw new Error("itch.io is limiting how fast LootDen can ask right now. Try again in a minute or two.");
          return res;
        }
        const after = Number(res.headers.get("retry-after"));
        await sleep(Math.min(30_000, after > 0 ? after * 1000 : gap * 2 ** (attempt + 1)));
      }
    };
    const next = this.itchQueue.then(run, run);
    this.itchQueue = next.catch(() => {});
    return next;
  }

  /** The game's id and title, from its page (or the page's data.json when the page won't load). */
  private async itchGame(url: URL): Promise<{ gameId: string; title: string }> {
    const known = this.itchIds.get(url.toString());
    if (known) return known;
    let gameId: string | undefined;
    let title: string | undefined;
    const page = await this.itchFetch(url.toString()).catch((err: Error) => err);
    if (page instanceof Response && page.ok) {
      const html = await page.text();
      gameId = html.match(/name="itch:path"\s+content="games\/(\d+)"/)?.[1] ?? html.match(/content="games\/(\d+)"\s+name="itch:path"/)?.[1];
      title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
    }
    if (!gameId) {
      const data = await this.itchFetch(`${url.origin}${url.pathname.replace(/\/$/, "")}/data.json`).catch(() => null);
      const j = data?.ok ? ((await data.json().catch(() => null)) as { id?: number; title?: string } | null) : null;
      if (j?.id) [gameId, title] = [String(j.id), title ?? j.title];
    }
    if (!gameId) {
      if (page instanceof Error) throw page;
      throw new Error(page.ok ? "Couldn't find the game on that page" : `itch.io answered ${page.status}`);
    }
    const found = { gameId, title: (title ?? url.pathname.replace(/\//g, "")).replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') };
    this.itchIds.set(url.toString(), found);
    return found;
  }

  /**
   * Downloads a free itch.io game's Windows (or Linux) build into the games folder.
   * Uses the same API the itch.io app uses, with the admin's own itch.io key.
   */
  async addItchGame(pageUrl: string, gamesDir: string): Promise<string> {
    const key = this.itchKey();
    if (!key) throw new Error("Add your itch.io API key under Settings, Other services first");
    const url = new URL(pageUrl);
    if (!/(^|\.)itch\.io$/.test(url.hostname)) throw new Error("That isn't an itch.io game page");
    const { gameId, title } = await this.itchGame(url);
    const auth = { Authorization: `Bearer ${key}` };

    const up = await this.itchFetch(`https://api.itch.io/games/${gameId}/uploads`, { headers: auth });
    if (!up.ok) throw new Error(up.status === 401 || up.status === 403 ? "itch.io didn't accept the key" : `itch.io answered ${up.status}`);
    const uploads = ((await up.json()) as { uploads?: ItchUpload[] }).uploads ?? [];
    const pick = pickItchUpload(uploads);
    if (!pick.upload) throw new Error(pick.why);

    const folder = path.join(gamesDir, safeFolderName(title));
    if (await stat(folder).catch(() => null)) throw new Error(`${path.basename(folder)} is already in the games folder`);
    const temp = path.join(gamesDir, `.itch-${gameId}.importing`);
    await rm(temp, { recursive: true, force: true });
    await mkdir(temp, { recursive: true });
    try {
      const dl = await this.itchFetch(`https://api.itch.io/uploads/${pick.upload.id}/download`, { headers: auth, redirect: "follow" });
      if (!dl.ok || !dl.body) throw new Error(`Download failed with ${dl.status}`);
      await pipeline(Readable.fromWeb(dl.body as import("node:stream/web").ReadableStream), createWriteStream(path.join(temp, path.basename(pick.upload.filename))));
      // A folder per game; zips inside are unpacked on each player's PC like any other game.
      // Remembered so update checks can compare with itch.io's newest upload (hidden from scans).
      await writeFile(path.join(temp, ".itch.json"), JSON.stringify({ gameId: Number(gameId), uploadId: pick.upload.id, updatedAt: pick.upload.updated_at ?? new Date().toISOString(), url: url.toString() }));
      await rename(temp, folder);
    } catch (err) {
      await rm(temp, { recursive: true, force: true });
      throw err;
    }
    return folder;
  }
}
