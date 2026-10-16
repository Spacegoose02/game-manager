import { titleKey } from "./calendar.js";
import type { FetchLike } from "./http.js";

/**
 * HowLongToBeat has no public API. Its site searches through a POST endpoint that moves every
 * few months (/api/find, /api/s, /api/search/site …) and wants a token from "<endpoint>/init"
 * first. So the endpoint is read from the site's own scripts, the known ones are tried after it,
 * and any failure just means no HowLongToBeat times (the caller falls back to IGDB).
 */
const BASE = "https://howlongtobeat.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const KNOWN = ["/api/search/site", "/api/s", "/api/find"];
const DAY = 24 * 3600_000;

export interface HltbTimes {
  /** Hours, rounded to the half hour. */
  main: number | null;
  normally: number | null;
  completely: number | null;
  count: number;
  url: string;
}

interface Session {
  path: string;
  token: string;
  /** Older versions of the site also wanted a "honeypot" key and value echoed back. */
  hpKey?: string;
  hpVal?: string;
}

interface Row {
  game_id: number;
  game_name: string;
  game_alias?: string;
  comp_main?: number;
  comp_plus?: number;
  comp_100?: number;
  comp_all_count?: number;
  count_comp?: number;
}

const hours = (s?: number) => (s ? Math.round((s / 3600) * 2) / 2 : null);

/** The POST endpoints the site's scripts call, e.g. fetch("/api/search/site", { method: "POST" … }). */
export function searchPathsIn(script: string): string[] {
  const out: string[] = [];
  for (const m of script.matchAll(/fetch\(\s*["'`](\/api\/[\w/]+?)(?:\/?["'`]|\$\{|\/["'`]\.concat)[\s\S]{0,300}?method:\s*["']POST["']/g)) out.push(m[1]!.replace(/\/+$/, ""));
  return out.filter((p) => !p.endsWith("/init"));
}

export class HowLongToBeat {
  private session: Session | null = null;
  private discovered: { at: number; paths: string[] } | null = null;
  private cache = new Map<string, { at: number; value: HltbTimes | null }>();

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private headers(extra: Record<string, string> = {}) {
    return { "User-Agent": UA, Referer: `${BASE}/`, Origin: BASE, ...extra };
  }

  private async text(url: string): Promise<string> {
    const res = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HowLongToBeat answered ${res.status}`);
    return res.text();
  }

  /** Search endpoints, newest guess first: what the site's scripts use today, then the known ones. */
  private async paths(): Promise<string[]> {
    if (this.discovered && Date.now() - this.discovered.at < DAY) return this.discovered.paths;
    const found: string[] = [];
    try {
      const html = await this.text(`${BASE}/`);
      const scripts = [...new Set([...html.matchAll(/src="([^"]*\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]!))];
      for (const src of scripts) {
        const js = await this.text(new URL(src, BASE).toString()).catch(() => "");
        found.push(...searchPathsIn(js));
        if (found.length) break;
      }
    } catch {
      // The known endpoints below still get a try.
    }
    const paths = [...new Set([...found, ...KNOWN])];
    this.discovered = { at: Date.now(), paths };
    return paths;
  }

  private async open(path: string): Promise<Session> {
    const res = await this.fetchImpl(`${BASE}${path}/init?t=${Date.now()}`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HowLongToBeat answered ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    if (typeof json.token !== "string") throw new Error("HowLongToBeat sent no search token");
    const hpKey = Object.entries(json).find(([k]) => /key/i.test(k))?.[1];
    const hpVal = Object.entries(json).find(([k]) => /val/i.test(k))?.[1];
    return { path, token: json.token, ...(typeof hpKey === "string" && typeof hpVal === "string" ? { hpKey, hpVal } : {}) };
  }

  private async post(s: Session, title: string): Promise<Row[]> {
    const body: Record<string, unknown> = {
      searchType: "games",
      searchTerms: title.split(/\s+/).filter(Boolean),
      searchPage: 1,
      size: 20,
      searchOptions: {
        games: { userId: 0, platform: "", sortCategory: "popular", rangeCategory: "main", rangeTime: { min: 0, max: 0 }, gameplay: { perspective: "", flow: "", genre: "", difficulty: "" }, rangeYear: { max: "", min: "" }, modifier: "" },
        users: { sortCategory: "postcount" },
        lists: { sortCategory: "follows" },
        filter: "",
        sort: 0,
        randomizer: 0,
      },
      useCache: true,
    };
    if (s.hpKey && s.hpVal) body[s.hpKey] = s.hpVal;
    const res = await this.fetchImpl(`${BASE}${s.path}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json", Accept: "*/*", "x-auth-token": s.token, ...(s.hpKey && s.hpVal ? { "x-hp-key": s.hpKey, "x-hp-val": s.hpVal } : {}) }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HowLongToBeat answered ${res.status}`);
    const json = (await res.json()) as { data?: Row[] };
    if (!Array.isArray(json.data)) throw new Error("HowLongToBeat sent an unexpected answer");
    return json.data;
  }

  /** Search with the current session; on failure open a new one, trying each endpoint once. */
  private async search(title: string): Promise<Row[]> {
    if (this.session) {
      try {
        return await this.post(this.session, title);
      } catch {
        this.session = null;
      }
    }
    let last: unknown = new Error("HowLongToBeat search isn't reachable");
    for (const path of await this.paths()) {
      try {
        const s = await this.open(path);
        const rows = await this.post(s, title);
        this.session = s;
        return rows;
      } catch (err) {
        last = err;
      }
    }
    this.discovered = null; // look at the site's scripts again next time
    throw last;
  }

  /** Times for a title: an exact title match, else the top result when it starts the same way. */
  async forTitle(title: string): Promise<HltbTimes | null> {
    const key = titleKey(title);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < DAY) return hit.value;
    const rows = await this.search(title.replace(/[™®©:]/g, " ").trim());
    const exact = rows.find((r) => titleKey(r.game_name) === key || (r.game_alias && titleKey(r.game_alias) === key));
    // "Hades II" isn't "Hades": only the top result, and only when the titles nearly agree.
    const top = rows[0] && titleKey(rows[0].game_name);
    const close = top && (top.startsWith(key) || key.startsWith(top)) && Math.min(top.length, key.length) / Math.max(top.length, key.length) >= 0.75;
    const best = exact ?? (close ? rows[0] : undefined);
    const value = best
      ? { main: hours(best.comp_main), normally: hours(best.comp_plus), completely: hours(best.comp_100), count: best.comp_all_count ?? best.count_comp ?? 0, url: `${BASE}/game/${best.game_id}` }
      : null;
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
