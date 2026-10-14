// Cover art fallbacks: what the server serves when a game's matched cover won't download.
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { makeApp, makeLibrary } from "./helpers.js";

let root: string;
before(async () => {
  root = await makeLibrary();
});
after(() => rm(root, { recursive: true, force: true }));

type Handler = (url: URL, init: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> } | undefined;

/** Fake fetch that answers from handlers and records every call. */
function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; body?: string }> = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), body: typeof init.body === "string" ? init.body : undefined });
    const r = handler(url, init);
    if (!r) return new Response("not found", { status: 404 });
    const isBuffer = r.body instanceof Uint8Array;
    return new Response(isBuffer ? Buffer.from(r.body as Uint8Array) : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: r.headers ?? { "content-type": isBuffer ? "image/jpeg" : "application/json" },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const SIMS_IGDB = {
  id: 72129,
  name: "The Sims 4",
  summary: "Life simulation.",
  first_release_date: 1409616000,
  total_rating: 71.4,
  cover: { image_id: "co1abc" },
  screenshots: [{ image_id: "sc1" }],
  genres: [{ name: "Simulator" }],
  themes: [{ name: "Sandbox" }],
  game_modes: [{ name: "Single player" }],
  platforms: [6, 48],
  age_ratings: [
    { organization: { name: "ESRB" }, rating_category: { rating: "T" } },
    { organization: { name: "PEGI" }, rating_category: { rating: "Twelve" } },
  ],
  external_games: [{ uid: "1222670", external_game_source: 1 }],
};

function igdbHandler(opts: { rejectNewFields?: boolean } = {}): Handler {
  return (url, init) => {
    if (url.host === "id.twitch.tv") return { body: { access_token: "tok", expires_in: 3600 } };
    if (url.host === "api.igdb.com") {
      const body = String(init.body);
      if (opts.rejectNewFields && body.includes("rating_category")) return { status: 400, body: [{ title: "Invalid Field" }] };
      if (body.startsWith("search")) {
        if (!body.includes('"The Sims 4"')) return { body: [] };
        return { body: [{ id: 999, name: "The Sims 3", platforms: [6] }, { ...SIMS_IGDB }] };
      }
      if (body.includes("where id = 72129")) {
        if (opts.rejectNewFields) {
          const { age_ratings: _a, external_games: _e, ...rest } = SIMS_IGDB;
          return { body: [{ ...rest, age_ratings: [{ category: 1, rating: 8 }], external_games: [{ uid: "1222670", category: 1 }] }] };
        }
        return { body: [SIMS_IGDB] };
      }
      return { body: [] };
    }
    if (url.host === "store.steampowered.com" && url.pathname === "/api/appdetails") {
      return {
        body: {
          "1222670": { success: true, data: { name: "The Sims 4", steam_appid: 1222670, required_age: 0, categories: [{ id: 2 }, { id: 18 }], genres: [] } },
        },
      };
    }
    if (url.host === "store.steampowered.com" && url.pathname === "/api/storesearch/") return { body: { items: [] } };
    if (url.host === "images.igdb.com") return { body: new Uint8Array([0xff, 0xd8, 0xff]) };
    return undefined;
  };
}

describe("artwork", () => {
  it("falls back to Steam art when the cover won't download, sharing one download", async () => {
    const base = igdbHandler();
    const fake = fakeFetch((url, init) => {
      if (url.host === "images.igdb.com" && url.pathname.includes("co1abc")) return { status: 404, body: "gone" };
      if (url.host === "cdn.cloudflare.steamstatic.com" && url.pathname.endsWith("/library_600x900.jpg")) return { body: new Uint8Array([0xff, 0xd8, 0xff, 1]) };
      return base(url, init);
    });
    const { ctx, app, config } = await makeApp(root, { apiToken: "svc", igdb: { clientId: "id", clientSecret: "secret" } }, { fetchImpl: fake.impl });
    const [sims] = ctx.library.list({ search: "sims" });
    await ctx.metadata.autoMatch(sims!.id);
    await rm(path.join(config.dataDir, "covers"), { recursive: true, force: true }); // drop the earlier test's cached cover

    const get = () => app.inject({ url: `/api/games/${sims!.id}/cover`, headers: { authorization: "Bearer svc" } });
    const [a, b] = await Promise.all([get(), get()]);
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
    assert.equal(a.rawPayload.length, 4, "served Steam's portrait art");
    assert.equal(fake.calls.filter((c) => c.url.endsWith("/library_600x900.jpg")).length, 1, "both requests shared one download");
    await app.close();
  });
});
