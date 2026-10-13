import { lookup } from "node:dns/promises";
import net from "node:net";
import type { FetchLike } from "../metadata/http.js";

export class SourceError extends Error {}

/** True for loopback, private, link-local and other addresses that aren't on the internet. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

export interface ClientOptions {
  /** Hosts this source may call. Anything else, including redirects elsewhere, is refused. */
  hosts: string[];
  perMinute: number;
  perHour: number;
  timeoutMs?: number;
  /** Times a 429 or 503 is retried after waiting. */
  retries?: number;
  /** Lets a source on your own network (e.g. 192.168.x.x) be reached; off for public sources. */
  allowPrivate?: boolean;
  userAgent?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The fetch every source uses: only the hosts it's allowed, a sliding one-minute window and
 * an hourly cap, a timeout, and a polite wait-and-retry when the server says slow down.
 */
export class SourceClient {
  private stamps: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly name: string,
    private readonly opts: ClientOptions,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address),
  ) {}

  /** Requests made in the last hour (for Settings). */
  get usedThisHour(): number {
    const cutoff = Date.now() - 3600_000;
    return this.stamps.filter((t) => t > cutoff).length;
  }

  private async checkUrl(raw: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SourceError(`${this.name}: "${raw}" isn't a web address`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new SourceError(`${this.name}: only http and https addresses`);
    if (url.username || url.password) throw new SourceError(`${this.name}: put credentials in the API key, not the address`);
    const host = url.hostname.toLowerCase();
    if (!this.opts.hosts.some((h) => host === h.toLowerCase())) throw new SourceError(`${this.name} isn't allowed to call ${host}; add it to the source's extra hosts in Settings`);
    if (!this.opts.allowPrivate) {
      const ips = net.isIP(host.replace(/^\[|\]$/g, "")) ? [host.replace(/^\[|\]$/g, "")] : await this.resolve(host).catch(() => []);
      if (!ips.length) throw new SourceError(`${this.name}: can't find ${host}`);
      if (ips.some(isPrivateAddress)) throw new SourceError(`${this.name}: ${host} is on a private network; switch on "On my network" for this source`);
    }
    return url;
  }

  /** Waits for a free slot in the minute window; refuses once the hourly cap is used. */
  private async slot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => t > now - 3600_000);
      if (this.stamps.length >= this.opts.perHour) throw new SourceError(`${this.name} has used its ${this.opts.perHour} requests for this hour`);
      const lastMinute = this.stamps.filter((t) => t > now - 60_000);
      if (lastMinute.length < this.opts.perMinute) {
        this.stamps.push(now);
        return;
      }
      await sleep(lastMinute[0]! + 60_000 - now + 5);
    }
  }

  /** A GET (or other request) to an allowed host. Redirects are followed only to allowed hosts. */
  fetch(raw: string, init: RequestInit = {}): Promise<Response> {
    const run = async (): Promise<Response> => {
      let url = await this.checkUrl(raw);
      for (let attempt = 0, hops = 0; ; ) {
        await this.slot();
        const res = await this.fetchImpl(url.toString(), {
          ...init,
          redirect: "manual",
          headers: { "User-Agent": this.opts.userAgent ?? "LootDen", Accept: "application/json, application/xml;q=0.9, */*;q=0.5", ...(init.headers as Record<string, string>) },
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
        }).catch((err: Error) => {
          throw new SourceError(`${this.name}: ${err.name === "TimeoutError" ? "took too long to answer" : `couldn't connect (${err.message})`}`);
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          if (++hops > 5) throw new SourceError(`${this.name}: too many redirects`);
          url = await this.checkUrl(new URL(res.headers.get("location")!, url).toString());
          continue;
        }
        if ((res.status === 429 || res.status === 503) && attempt < (this.opts.retries ?? 3)) {
          const after = Number(res.headers.get("retry-after"));
          await sleep(Math.min(60_000, after > 0 ? after * 1000 : 2000 * 2 ** attempt));
          attempt++;
          continue;
        }
        if (res.status === 429) throw new SourceError(`${this.name} is limiting requests right now; try again later`);
        return res;
      }
    };
    // One request at a time per source keeps the limits honest.
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  /** fetch + JSON, with a readable error for non-2xx answers. */
  async json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetch(url, init);
    if (res.status === 401 || res.status === 403) throw new SourceError(`${this.name} didn't accept the API key (${res.status})`);
    if (!res.ok) throw new SourceError(`${this.name} answered ${res.status}`);
    return (await res.json()) as T;
  }

  async text(url: string, init?: RequestInit): Promise<string> {
    const res = await this.fetch(url, init);
    if (!res.ok) throw new SourceError(`${this.name} answered ${res.status}`);
    return res.text();
  }
}

/**
 * Collects pages until a page comes back empty, `next` says stop, or `maxPages` is reached.
 * `page(n)` gets 1, 2, 3…; return the items and whether there's another page.
 */
export async function paginate<T>(page: (n: number) => Promise<{ items: T[]; more: boolean }>, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  for (let n = 1; n <= maxPages; n++) {
    const { items, more } = await page(n);
    out.push(...items);
    if (!items.length || !more) break;
  }
  return out;
}
