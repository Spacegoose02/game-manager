import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HowLongToBeat, searchPathsIn } from "../src/metadata/hltb.js";

const rows = [
  { game_id: 10270, game_name: "The Witcher 3: Wild Hunt", comp_main: 51.5 * 3600, comp_plus: 103 * 3600, comp_100: 173.2 * 3600, comp_all_count: 9000 },
  { game_id: 1, game_name: "The Witcher 3: Wild Hunt - Blood and Wine", comp_main: 3600 },
];

/** A fake howlongtobeat.com whose search lives at `path`; records what it was asked. */
function site(path: string, opts: { script?: string; hp?: boolean } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/") return new Response(`<script src="/_next/static/chunks/pages/_app-abc.js"></script>`);
    if (url.pathname === "/_next/static/chunks/pages/_app-abc.js") return new Response(opts.script ?? "");
    if (url.pathname === `${path}/init`) return Response.json(opts.hp ? { token: "tok", hpKey: "ign_x", hpVal: "v1" } : { token: "tok" });
    if (url.pathname === path && init?.method === "POST") {
      const h = new Headers(init.headers);
      if (h.get("x-auth-token") !== "tok") return new Response("no", { status: 403 });
      const body = JSON.parse(String(init.body));
      if (opts.hp) assert.equal(body.ign_x, "v1");
      return Response.json({ data: rows });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("HowLongToBeat", () => {
  it("finds the search endpoint in the site's scripts", () => {
    const js = `a=fetch("/api/search/site/init?t=".concat(n),{method:"GET"});b=fetch("/api/search/site",{method:"POST",headers:h,body:JSON.stringify(q)})`;
    assert.deepEqual(searchPathsIn(js), ["/api/search/site"]);
    assert.deepEqual(searchPathsIn(`fetch("/api/s/".concat(k),{method:"POST"})`), ["/api/s"]);
  });

  it("reads times for the matching title from a discovered endpoint", async () => {
    const { fetchImpl, calls } = site("/api/lookup", { script: `fetch("/api/lookup",{method:"POST",body:x})` });
    const t = await new HowLongToBeat(fetchImpl).forTitle("The Witcher 3: Wild Hunt");
    assert.deepEqual(t, { main: 51.5, normally: 103, completely: 173, count: 9000, url: "https://howlongtobeat.com/game/10270" });
    assert.ok(calls.includes("POST /api/lookup"));
  });

  it("falls back to the known endpoints and echoes the honeypot pair", async () => {
    const { fetchImpl } = site("/api/s", { hp: true });
    const t = await new HowLongToBeat(fetchImpl).forTitle("The Witcher 3: Wild Hunt");
    assert.equal(t?.main, 51.5);
  });

  it("returns nothing for a title it doesn't know, and throws when the site is down", async () => {
    const { fetchImpl } = site("/api/search/site");
    assert.equal(await new HowLongToBeat(fetchImpl).forTitle("Witcher"), null);
    const down = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    await assert.rejects(new HowLongToBeat(down).forTitle("Celeste"));
  });
});
