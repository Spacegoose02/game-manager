import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { parseFeed } from "../src/news/service.js";
import { makeApp, makeLibrary } from "./helpers.js";

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Game News</title>
<item><title>Patch &amp; notes</title><link>https://news.example/a</link><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate>
<description><![CDATA[<p>Big <b>update</b></p><img src="https://img.example/a.jpg">]]></description></item>
<item><title>Older</title><link>https://news.example/b</link><pubDate>Sun, 11 Oct 2026 10:00:00 GMT</pubDate><media:content url="https://img.example/b.jpg"/></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Games</title>
<entry><title>Newest</title><link rel="alternate" href="https://atom.example/1"/><updated>2026-10-12T12:00:00Z</updated><summary>Hello</summary></entry></feed>`;

let root: string;
before(async () => {
  root = await makeLibrary();
});
after(() => rm(root, { recursive: true, force: true }));

describe("news feeds", () => {
  it("parses RSS and Atom", () => {
    const rss = parseFeed(RSS, { id: "r", url: "", title: "" });
    assert.equal(rss.title, "Game News");
    assert.equal(rss.items[0]!.title, "Patch & notes");
    assert.equal(rss.items[0]!.summary, "Big update");
    assert.equal(rss.items[0]!.image, "https://img.example/a.jpg");
    assert.equal(rss.items[1]!.image, "https://img.example/b.jpg");
    const atom = parseFeed(ATOM, { id: "a", url: "", title: "" });
    assert.equal(atom.items[0]!.link, "https://atom.example/1");
  });

  it("lets admins add feeds and merges them newest first", async () => {
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("rss")) return new Response(RSS);
      if (u.includes("atom")) return new Response(ATOM);
      return new Response("<html>nope</html>");
    }) as typeof fetch;
    const { app } = await makeApp(root, { apiToken: "svc" }, { fetchImpl });
    const headers = { authorization: "Bearer svc" };
    assert.equal((await app.inject({ method: "POST", url: "/api/news/feeds", headers, payload: { url: "https://x.example/page" } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/news/feeds", headers, payload: { url: "https://x.example/rss" } })).json().title, "Game News");
    await app.inject({ method: "POST", url: "/api/news/feeds", headers, payload: { url: "https://x.example/atom", title: "Mine" } });
    const news = (await app.inject({ url: "/api/news", headers })).json();
    assert.deepEqual(news.items.map((i: { title: string }) => i.title), ["Newest", "Patch & notes", "Older"]);
    assert.equal(news.items[0].feedTitle, "Mine");
    await app.close();
  });
});
