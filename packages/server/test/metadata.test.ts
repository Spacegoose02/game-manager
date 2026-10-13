import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import type { GameDetail } from "@game-manager/shared";
import { kidSafeFromRatings } from "../src/metadata/ratings.js";
import { cleanTitle, titleSimilarity } from "../src/metadata/titles.js";
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

describe("title cleaning and matching", () => {
  it("strips release noise", () => {
    assert.deepEqual(cleanTitle("The.Sims.4.v1.98.127-GOG"), { query: "The Sims 4", year: null });
    assert.deepEqual(cleanTitle("Grand Theft Auto V [FitGirl Repack]"), { query: "Grand Theft Auto V", year: null });
    assert.deepEqual(cleanTitle("Prey (2017) MULTi12-ElAmigos.part1.rar"), { query: "Prey", year: 2017 });
    assert.equal(cleanTitle("DOOM_Eternal_Build_8873").query, "DOOM Eternal");
  });

  it("scores roman numerals, articles and punctuation as equal", () => {
    assert.equal(titleSimilarity("Grand Theft Auto V", "Grand Theft Auto 5"), 1);
    assert.equal(titleSimilarity("The Witcher 3: Wild Hunt", "Witcher 3 Wild Hunt"), 1);
    assert.ok(titleSimilarity("The Sims 4", "The Sims 3") < 0.7);
  });

  it("derives kid safety from age ratings", () => {
    assert.equal(kidSafeFromRatings([{ organization: "ESRB", rating: "E10+" }, { organization: "PEGI", rating: "7" }]), true);
    assert.equal(kidSafeFromRatings([{ organization: "ESRB", rating: "E" }, { organization: "PEGI", rating: "12" }]), false);
    assert.equal(kidSafeFromRatings([{ organization: "STEAM", rating: "17+" }]), false);
    assert.equal(kidSafeFromRatings([]), null);
  });
});

describe("metadata service", () => {
  it("matches with IGDB, adds Steam controller support, caches the cover", async () => {
    const fake = fakeFetch(igdbHandler());
    const { ctx, app } = await makeApp(root, { apiToken: "svc", igdb: { clientId: "id", clientSecret: "secret" } }, { fetchImpl: fake.impl });
    const [sims] = ctx.library.list({ search: "sims" });
    await ctx.metadata.autoMatch(sims!.id);

    const game = ctx.library.get(sims!.id)!;
    assert.equal(game.metadata?.providerId, "72129", "picked The Sims 4 over The Sims 3");
    assert.equal(game.title, "The Sims 4");
    assert.deepEqual(game.genres, ["Simulator"]);
    assert.equal(game.releaseYear, 2014);
    assert.equal(game.rating, 71);
    assert.equal(game.controllerSupport, "partial");
    assert.equal(game.kidSafe, false);
    assert.deepEqual(game.metadata?.ageRatings, [
      { organization: "ESRB", rating: "T" },
      { organization: "PEGI", rating: "12" },
    ]);

    const cover = await app.inject({ url: `/api/games/${sims!.id}/cover`, headers: { authorization: "Bearer svc" } });
    assert.equal(cover.statusCode, 200);
    assert.equal(cover.headers["content-type"], "image/jpeg");
    const before = fake.calls.length;
    await app.inject({ url: `/api/games/${sims!.id}/cover`, headers: { authorization: "Bearer svc" } });
    assert.equal(fake.calls.length, before, "second cover request is served from the cache");
    await app.close();
  });

  it("falls back to IGDB's older field names when the new ones are rejected", async () => {
    const fake = fakeFetch(igdbHandler({ rejectNewFields: true }));
    const { ctx } = await makeApp(root, { igdb: { clientId: "id", clientSecret: "secret" } }, { fetchImpl: fake.impl });
    const [sims] = ctx.library.list({ search: "sims" });
    await ctx.metadata.autoMatch(sims!.id);
    const game = ctx.library.get(sims!.id)!;
    assert.deepEqual(game.metadata?.ageRatings, [{ organization: "ESRB", rating: "E" }]);
    assert.equal(game.metadata?.steamAppId, "1222670");
    assert.equal(game.kidSafe, true);
  });

  it("uses the keyless Steam store when IGDB is not configured, and PCGamingWiki for controllers", async () => {
    const fake = fakeFetch((url) => {
      if (url.pathname === "/api/storesearch/") {
        return { body: { items: url.searchParams.get("term") === "Portal 2" ? [{ id: 620, name: "Portal 2", type: "app" }] : [] } };
      }
      if (url.pathname === "/api/appdetails") {
        return {
          body: {
            "620": {
              success: true,
              data: {
                name: "Portal 2",
                steam_appid: 620,
                required_age: 0,
                short_description: "Puzzle <b>game</b>",
                genres: [{ description: "Action" }, { description: "Adventure" }],
                categories: [{ id: 2, description: "Single-player" }],
                release_date: { date: "18 Apr, 2011" },
                metacritic: { score: 95 },
              },
            },
          },
        };
      }
      if (url.host === "www.pcgamingwiki.com") return { body: { cargoquery: [{ title: { controller: "true", full: "true" } }] } };
      return undefined;
    });
    const { ctx } = await makeApp(root, {}, { fetchImpl: fake.impl });
    assert.deepEqual(ctx.metadata.status().providers, ["steam"]);
    const [portal] = ctx.library.list({ search: "portal" });
    await ctx.metadata.autoMatch(portal!.id);
    const game = ctx.library.get(portal!.id)!;
    assert.equal(game.metadata?.provider, "steam");
    assert.equal(game.metadata?.summary, "Puzzle game");
    assert.equal(game.releaseYear, 2011);
    assert.equal(game.rating, 95);
    assert.equal(game.controllerSupport, "full");
    assert.equal(game.kidSafe, null);
    assert.ok(fake.calls.some((c) => c.url.includes("Steam_AppID")));
  });

  it("leaves unmatched games for an admin, who can match by hand", async () => {
    const fake = fakeFetch(igdbHandler());
    const { ctx, app } = await makeApp(root, { apiToken: "svc", igdb: { clientId: "id", clientSecret: "secret" } }, { fetchImpl: fake.impl });
    const [gta] = ctx.library.list({ search: "grand" });
    assert.equal(await ctx.metadata.autoMatch(gta!.id), null);
    assert.equal(ctx.metadata.status().unmatched, 3);
    // Not retried on the next scan.
    assert.equal(ctx.metadata.queueMissing(ctx.library.allScanned().filter((g) => g.id === gta!.id)), 0);

    const put = await app.inject({
      method: "PUT",
      url: `/api/games/${gta!.id}/metadata`,
      headers: { authorization: "Bearer svc" },
      payload: { provider: "igdb", providerId: "72129" },
    });
    assert.equal(put.statusCode, 200);
    assert.equal(put.json<GameDetail>().metadata?.locked, true);
    // Locked matches survive automatic matching.
    assert.equal(await ctx.metadata.autoMatch(gta!.id), null);
    assert.equal(ctx.library.get(gta!.id)!.metadata?.providerId, "72129");
    await app.close();
  });
});
