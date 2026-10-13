import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { parseSteamSearch, steamDate, titleKey } from "../src/metadata/calendar.js";
import { parseYouTubeFeed } from "../src/news/videos.js";
import { makeApp, makeLibrary } from "./helpers.js";

let root: string;
before(async () => {
  root = await makeLibrary();
});
after(() => rm(root, { recursive: true, force: true }));

const STEAM_HTML =
  '<a href="https://store.steampowered.com/app/2644100/Allogloom/?snr=1" data-ds-appid="2644100" class="search_result_row">' +
  '<span class="title">Allogloom</span><div class="search_released responsive_secondrow">Oct 13, 2026</div></a>' +
  '<a href="https://store.steampowered.com/app/555/Portal_2/" data-ds-appid="555"><span class="title">Portal 2</span>' +
  '<div class="search_released responsive_secondrow">\n  Q1 2027 </div></a>';

const YT_FEED = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
<title>IGN</title><author><name>IGN</name></author>
<entry><yt:videoId>abc123</yt:videoId><title>Big Game - Official Trailer</title><author><name>IGN</name></author><published>2026-10-12T15:00:00+00:00</published>
<media:group><media:thumbnail url="https://i1.ytimg.com/vi/abc123/hqdefault.jpg" width="480" height="360"/></media:group></entry>
<entry><yt:videoId>short1</yt:videoId><title>Wow #shorts</title><published>2026-10-12T16:00:00+00:00</published></entry>
</feed>`;

describe("release calendar and discover", () => {
  it("parses Steam search rows and dates", () => {
    const rows = parseSteamSearch(STEAM_HTML);
    assert.deepEqual(rows, [
      { appId: "2644100", name: "Allogloom", released: "Oct 13, 2026" },
      { appId: "555", name: "Portal 2", released: "Q1 2027" },
    ]);
    assert.equal(steamDate("Oct 13, 2026"), "2026-10-13");
    assert.equal(steamDate("3 Feb, 2027"), "2027-02-03");
    assert.equal(steamDate("Q1 2027"), null);
    assert.equal(titleKey("The Witcher® 3: Wild Hunt"), titleKey("witcher 3 wild hunt"));
  });

  it("falls back to Steam without keys and links library games", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      if (url.pathname === "/search/results/") return Response.json({ results_html: STEAM_HTML });
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    const { app, ctx } = await makeApp(root, { apiToken: "svc" }, { fetchImpl });
    const headers = { authorization: "Bearer svc" };
    const cal = (await app.inject({ url: "/api/calendar", headers })).json();
    assert.equal(cal.source, "Steam");
    assert.equal(cal.items[0].name, "Allogloom");
    assert.equal(cal.items[0].releaseDate, "2026-10-13");
    assert.equal(cal.items[1].dateText, "Q1 2027");
    assert.equal(cal.items[1].libraryId, ctx.library.list({ search: "portal" })[0]!.id);
    await app.inject({ url: "/api/calendar", headers });
    assert.equal(calls.length, 1, "second request is served from cache");

    const kid = await ctx.users.create({ username: "kiddo", password: "password1", kidMode: true });
    const asKid = { authorization: `Bearer ${ctx.auth.createApiToken(kid.id, "t").token}` };
    assert.equal((await app.inject({ url: "/api/calendar", headers: asKid })).statusCode, 403);
    await app.close();
  });
});

describe("youtube videos", () => {
  it("parses channel feeds and skips shorts", () => {
    const { channel, videos } = parseYouTubeFeed(YT_FEED);
    assert.equal(channel, "IGN");
    assert.equal(videos.length, 1);
    assert.equal(videos[0]!.url, "https://www.youtube.com/watch?v=abc123");
    assert.equal(videos[0]!.thumbnail, "https://i1.ytimg.com/vi/abc123/hqdefault.jpg");
  });

  it("seeds trailer channels, resolves @handles and serves rows", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/@SkillUp") return new Response('<link rel="canonical" href="https://www.youtube.com/channel/UCZ7AeeVbyslLM_8-nVy2B8Q">');
      if (url.pathname === "/feeds/videos.xml") return new Response(YT_FEED.replace("<title>IGN</title>", url.searchParams.get("channel_id")!.startsWith("UCZ7") ? "<title>Skill Up</title>" : "<title>IGN</title>"));
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    const { app } = await makeApp(root, { apiToken: "svc" }, { fetchImpl });
    const headers = { authorization: "Bearer svc" };
    const groups = (await app.inject({ url: "/api/videos/groups", headers })).json();
    assert.equal(groups[0].title, "Game Trailers");
    assert.equal(groups[0].channels.length, 3);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/videos/groups",
      headers,
      payload: { groups: [...groups.map((g: { channels: Array<{ id: string }> }) => ({ ...g, channels: g.channels.map((c) => c.id) })), { title: "Game Reviews", channels: ["@SkillUp"] }] },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json()[1].channels, [{ id: "UCZ7AeeVbyslLM_8-nVy2B8Q", name: "Skill Up" }]);
    const bad = await app.inject({ method: "PUT", url: "/api/videos/groups", headers, payload: { groups: [{ title: "X", channels: ["not a channel"] }] } });
    assert.equal(bad.statusCode, 400);

    const rows = (await app.inject({ url: "/api/videos", headers })).json();
    assert.equal(rows.groups.length, 2);
    assert.equal(rows.groups[1].videos[0].title, "Big Game - Official Trailer");
    await app.close();
  });
});
