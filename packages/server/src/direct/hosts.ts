import type { FetchLike } from "../metadata/http.js";

/** A file host's page turned into something that can be downloaded with a plain GET. */
export interface ResolvedLink {
  /** The host it came from, for the UI ("MediaFire", "Datanodes", "Direct link"). */
  host: string;
  /** Direct file URL. These usually expire, so they're resolved again before each download. */
  url: string;
  fileName: string | null;
  sizeBytes: number | null;
  /** Extra headers the host wants on the download itself (cookies, referer). */
  headers?: Record<string, string>;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BASE_HEADERS = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" };

export class LinkError extends Error {}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** File name from a Content-Disposition header (RFC 5987 form first). */
export function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*(?:[\w-]+)?''([^;]+)/i)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star.trim().replace(/^"|"$/g, ""));
    } catch {
      // fall through to the plain form
    }
  }
  return header.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ?? header.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim() ?? null;
}

/** The last path segment of a URL, when it looks like a file name. */
export function urlFileName(url: string): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    return /\.[a-z0-9]{1,5}$/i.test(last) ? last : null;
  } catch {
    return null;
  }
}

const sizeFrom = (r: Response) => {
  const range = r.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
  const n = Number(range ?? r.headers.get("content-length"));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const isHtml = (r: Response) => /text\/html|application\/xhtml/i.test(r.headers.get("content-type") ?? "");

async function page(fetchImpl: FetchLike, url: string, init: RequestInit = {}): Promise<{ res: Response; html: string }> {
  const res = await fetchImpl(url, { ...init, headers: { ...BASE_HEADERS, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404 || res.status === 410) throw new LinkError("The file host says this file doesn't exist (removed or a wrong link)");
  if (!res.ok && !(res.status >= 300 && res.status < 400)) throw new LinkError(`The file host answered HTTP ${res.status}`);
  return { res, html: await res.text() };
}

/** Pulls the cookies out of a response, as a Cookie header value. */
function cookiesOf(res: Response): string {
  const all = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
  return all.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

// ---- MediaFire ----------------------------------------------------------------------

async function mediafire(url: string, fetchImpl: FetchLike): Promise<ResolvedLink> {
  if (/\/folder\//i.test(url)) throw new LinkError("That's a MediaFire folder; paste the link of each file in it instead");
  const { html } = await page(fetchImpl, url);
  // The button holds the link, either plainly or base64-encoded in data-scrambled-url.
  const button = html.match(/<a[^>]+id=["']downloadButton["'][^>]*>/i)?.[0] ?? "";
  const scrambled = button.match(/data-scrambled-url=["']([^"']+)["']/i)?.[1];
  let direct = scrambled ? Buffer.from(scrambled, "base64").toString("utf8") : button.match(/href=["'](https?:\/\/[^"']+)["']/i)?.[1];
  direct ??= html.match(/https?:\/\/download\d*\.mediafire\.com\/[^"'\s<>]+/i)?.[0];
  if (!direct) {
    if (/dangerous|blocked|this file is no longer available|file removed/i.test(html)) throw new LinkError("MediaFire has removed or blocked this file");
    throw new LinkError("Couldn't find the download button on the MediaFire page");
  }
  direct = decode(direct);
  const name = html.match(/<div[^>]+class=["'][^"']*\bfilename\b[^"']*["'][^>]*>([^<]+)</i)?.[1]?.trim() ?? urlFileName(direct);
  const size = button.match(/\(([\d.]+)\s*(KB|MB|GB)\)/i);
  return { host: "MediaFire", url: direct, fileName: name ? decode(name) : null, sizeBytes: size ? Math.round(Number(size[1]) * 1024 ** (["KB", "MB", "GB"].indexOf(size[2]!.toUpperCase()) + 1)) : null };
}

// ---- Datanodes and other XFileSharing sites ----------------------------------------------

/** Reads a hidden form field's value from an XFileSharing download page. */
const field = (html: string, name: string) =>
  html.match(new RegExp(`<input[^>]+name=["']${name}["'][^>]*value=["']([^"']*)["']`, "i"))?.[1] ??
  html.match(new RegExp(`<input[^>]+value=["']([^"']*)["'][^>]*name=["']${name}["']`, "i"))?.[1] ??
  null;

/** Where an XFileSharing "free download" form submission leads: a redirect, JSON, or a link in the page. */
async function followXfs(res: Response, base: string, host: string, cookie: string): Promise<ResolvedLink | null> {
  const location = res.headers.get("location");
  if (location) {
    const direct = new URL(location, base).toString();
    return { host, url: direct, fileName: urlFileName(direct), sizeBytes: null, headers: cookie ? { Cookie: cookie, Referer: base } : { Referer: base } };
  }
  const body = await res.text();
  try {
    const j = JSON.parse(body) as { url?: string; link?: string; direct_link?: string };
    const direct = j.url ?? j.link ?? j.direct_link;
    if (direct) return { host, url: decodeURIComponent(direct), fileName: urlFileName(decodeURIComponent(direct)), sizeBytes: null, headers: { Referer: base } };
  } catch {
    // HTML, handled below
  }
  // The page after the form usually has one big link straight to the file.
  const links = [...body.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((m) => decode(m[1]!));
  const direct =
    links.find((l) => /\.(rar|zip|7z|iso|exe|bin|r\d\d|\d{3})($|\?)/i.test(l)) ?? links.find((l) => /\/(d|dl|files?|cgi-bin\/dl\.cgi)\/[^?#]+\.[a-z0-9]{2,5}($|\?)/i.test(l));
  return direct ? { host, url: direct, fileName: urlFileName(direct), sizeBytes: null, headers: { Referer: base } } : null;
}

async function xfileSharing(url: string, fetchImpl: FetchLike, host: string, opts: { firstHtml?: string; firstRes?: Response } = {}): Promise<ResolvedLink> {
  let html = opts.firstHtml;
  let res = opts.firstRes;
  if (html === undefined) ({ html, res } = await page(fetchImpl, url));
  let cookie = res ? cookiesOf(res) : "";
  const code = field(html, "id") ?? new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
  if (!code) throw new LinkError(`Couldn't find the file on the ${host} page`);
  const fname = field(html, "fname") ?? new URL(url).pathname.split("/").filter(Boolean)[1] ?? "";
  const post = async (op: string, extra: Record<string, string> = {}) => {
    const body = new URLSearchParams({ op, id: code, rand: field(html!, "rand") ?? "", referer: field(html!, "referer") ?? "", method_free: "Free Download >>", method_premium: "", ...extra });
    if (fname) body.set("fname", fname);
    return fetchImpl(url, {
      method: "POST",
      redirect: "manual",
      body,
      headers: { ...BASE_HEADERS, "Content-Type": "application/x-www-form-urlencoded", Referer: url, ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(30_000),
    });
  };
  // Some sites have a first "download1" step that leads to the real form.
  if (/name=["']op["'][^>]*value=["']download1["']/i.test(html) || /value=["']download1["'][^>]*name=["']op["']/i.test(html)) {
    const r = await post("download1");
    cookie = [cookie, cookiesOf(r)].filter(Boolean).join("; ");
    html = await r.text();
  }
  const second = await post("download2");
  if (second.status === 404) throw new LinkError(`${host} says this file doesn't exist`);
  const found = await followXfs(second, url, host, [cookie, cookiesOf(second)].filter(Boolean).join("; "));
  if (!found) throw new LinkError(`${host} didn't hand over a download link (it may want a captcha or a premium account)`);
  if (!found.fileName && fname) found.fileName = decodeURIComponent(fname);
  return found;
}

async function datanodes(url: string, fetchImpl: FetchLike): Promise<ResolvedLink> {
  const u = new URL(url);
  const [code, name] = u.pathname.split("/").filter(Boolean);
  if (!code) throw new LinkError("That Datanodes link has no file code in it");
  // Datanodes takes the form straight away; the cookies are what its own page would set.
  const target = `${u.origin}/download`;
  const cookie = `lang=english; file_code=${code}${name ? `; file_name=${name}` : ""}`;
  const res = await fetchImpl(target, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({ op: "download2", id: code, rand: "", referer: target, method_free: "Free Download >>", method_premium: "", adblock_detected: "" }),
    headers: { ...BASE_HEADERS, "Content-Type": "application/x-www-form-urlencoded", Referer: url, Origin: u.origin, Cookie: cookie },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) throw new LinkError("Datanodes says this file doesn't exist");
  const found = await followXfs(res, url, "Datanodes", cookie);
  if (found) {
    if (!found.fileName && name) found.fileName = decodeURIComponent(name);
    return found;
  }
  // Fall back to the page's own form, in case Datanodes changed its shortcut.
  return xfileSharing(url, fetchImpl, "Datanodes");
}

// ---- Smaller hosts with simple rules ---------------------------------------------------------

async function pixeldrain(url: string, fetchImpl: FetchLike): Promise<ResolvedLink> {
  const id = new URL(url).pathname.match(/\/(?:u|api\/file)\/([\w-]+)/)?.[1];
  if (!id) throw new LinkError("That Pixeldrain link has no file id (lists aren't supported; paste each file)");
  const origin = new URL(url).origin;
  let fileName: string | null = null;
  let sizeBytes: number | null = null;
  try {
    const info = (await (await fetchImpl(`${origin}/api/file/${id}/info`, { headers: BASE_HEADERS, signal: AbortSignal.timeout(20_000) })).json()) as { name?: string; size?: number };
    fileName = info.name ?? null;
    sizeBytes = info.size ?? null;
  } catch {
    // the download still works without the details
  }
  return { host: "Pixeldrain", url: `${origin}/api/file/${id}?download`, fileName, sizeBytes };
}

async function buzzheavier(url: string, fetchImpl: FetchLike): Promise<ResolvedLink> {
  const u = new URL(url);
  const id = u.pathname.split("/").filter(Boolean)[0];
  if (!id) throw new LinkError("That Buzzheavier link has no file id");
  const res = await fetchImpl(`${u.origin}/${id}/download`, {
    redirect: "manual",
    headers: { ...BASE_HEADERS, "HX-Request": "true", "HX-Current-URL": `${u.origin}/${id}`, Referer: `${u.origin}/${id}` },
    signal: AbortSignal.timeout(30_000),
  });
  const direct = res.headers.get("hx-redirect") ?? res.headers.get("location");
  if (!direct) throw new LinkError("Buzzheavier didn't hand over a download link");
  return { host: "Buzzheavier", url: new URL(direct, u.origin).toString(), fileName: null, sizeBytes: null };
}

function googleDrive(url: string): ResolvedLink {
  const u = new URL(url);
  const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? u.searchParams.get("id");
  if (!id) throw new LinkError("That Google Drive link has no file id (folders aren't supported)");
  // confirm=t skips the "can't scan this file for viruses" page for big files.
  return { host: "Google Drive", url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, fileName: null, sizeBytes: null };
}

/** Anything else: a direct file link, or a page with an XFileSharing download form. */
async function generic(url: string, fetchImpl: FetchLike): Promise<ResolvedLink> {
  const res = await fetchImpl(url, { headers: { ...BASE_HEADERS, Range: "bytes=0-0" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new LinkError(`The link answered HTTP ${res.status}`);
  if (!isHtml(res)) {
    void res.body?.cancel().catch(() => {});
    return { host: "Direct link", url, fileName: dispositionName(res.headers.get("content-disposition")) ?? urlFileName(res.url || url), sizeBytes: sizeFrom(res) };
  }
  const html = await res.text();
  if (/name=["']op["'][^>]*value=["']download[12]["']|value=["']download[12]["'][^>]*name=["']op["']/i.test(html)) {
    return xfileSharing(url, fetchImpl, new URL(url).hostname.replace(/^www\./, ""), { firstHtml: html, firstRes: res });
  }
  throw new LinkError("That link is a web page, not a file, and LootDen doesn't know this host yet");
}

export interface HostRule {
  name: string;
  match: RegExp;
  resolve: (url: string, fetchImpl: FetchLike) => Promise<ResolvedLink> | ResolvedLink;
}

/** Hosts LootDen knows by name. Anything else goes through the generic resolver. */
export const HOSTS: HostRule[] = [
  { name: "MediaFire", match: /(^|\.)mediafire\.com$/i, resolve: mediafire },
  { name: "Datanodes", match: /(^|\.)datanodes\.to$/i, resolve: datanodes },
  { name: "Pixeldrain", match: /(^|\.)pixeldrain\.(com|net)$/i, resolve: pixeldrain },
  { name: "Buzzheavier", match: /(^|\.)(buzzheavier\.com|bzzhr\.co|fuckingfast\.net)$/i, resolve: buzzheavier },
  { name: "Google Drive", match: /^(drive|docs)\.google\.com$/i, resolve: googleDrive },
];

/** Hosts that need an account or a browser, so they fail with a clear message instead of a vague one. */
const UNSUPPORTED: Array<[RegExp, string]> = [
  [/(^|\.)gofile\.io$/i, "Gofile"],
  [/(^|\.)1fichier\.com$/i, "1fichier"],
  [/(^|\.)mega\.(nz|co\.nz)$/i, "MEGA"],
  [/(^|\.)rapidgator\.net$/i, "Rapidgator"],
];

/** Normalises pasted text into the links in it, one per line or separated by spaces. */
export function parseLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return [...new Set(found.map((l) => l.replace(/[),.;]+$/, "")))];
}

export function hostName(url: string): string {
  const h = new URL(url).hostname;
  return HOSTS.find((r) => r.match.test(h))?.name ?? UNSUPPORTED.find(([m]) => m.test(h))?.[1] ?? h.replace(/^www\./, "");
}

/** Turns a file host link into a direct download. */
export async function resolveLink(url: string, fetchImpl: FetchLike = fetch): Promise<ResolvedLink> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new LinkError("That isn't a link");
  }
  if (!/^https?:$/.test(u.protocol)) throw new LinkError("Only http and https links can be downloaded");
  const blocked = UNSUPPORTED.find(([m]) => m.test(u.hostname));
  if (blocked) throw new LinkError(`${blocked[1]} needs an account or a browser to download, so LootDen can't fetch it on its own`);
  const rule = HOSTS.find((r) => r.match.test(u.hostname));
  try {
    return await (rule ? rule.resolve(url, fetchImpl) : generic(url, fetchImpl));
  } catch (err) {
    if (err instanceof LinkError) throw err;
    throw new LinkError(`Couldn't reach ${rule?.name ?? u.hostname}: ${(err as Error).message}`);
  }
}
