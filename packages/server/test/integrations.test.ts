import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { makeApp, makeLibrary } from "./helpers.js";

let root: string;
before(async () => {
  root = await makeLibrary();
});
after(() => rm(root, { recursive: true, force: true }));

function fake(handler: (url: URL) => { status?: number; body: unknown; type?: string } | undefined) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const r = handler(url);
    if (!r) return new Response("not found", { status: 404 });
    const raw = r.body instanceof Uint8Array;
    return new Response(raw ? Buffer.from(r.body as Uint8Array) : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": r.type ?? (raw ? "image/png" : "application/json") },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

describe("integrations settings", () => {
  it("stores keys from the UI, masks secrets and falls back to the environment", async () => {
    const { app, config } = await makeApp(root, { apiToken: "svc", igdb: { clientId: "env-id", clientSecret: "env-secret" } });
    const headers = { authorization: "Bearer svc" };
    let view = (await app.inject({ url: "/api/settings/integrations", headers })).json();
    assert.deepEqual(view.fromEnvironment, ["igdb"]);
    assert.equal(view.settings.igdb.clientId, "");

    const put = await app.inject({
      method: "PUT",
      url: "/api/settings/integrations",
      headers,
      payload: {
        publicUrl: "https://games.example.com/",
        rawg: { apiKey: "rawg-key" },
        oidc: { issuer: "https://auth.example.com/", clientId: "gm", clientSecret: "s3cret", name: "TinyAuth", adminGroup: "admins", autoCreate: true },
      },
    });
    assert.equal(put.statusCode, 200);
    view = put.json();
    assert.equal(view.settings.rawg.apiKey, "********");
    assert.equal(view.settings.oidc.clientSecret, "********");
    assert.equal(view.callbackUrl, "https://games.example.com/api/auth/oidc/callback");
    assert.equal(config.rawg.apiKey, "rawg-key");
    assert.equal(config.oidc.issuer, "https://auth.example.com");
    assert.equal(config.igdb.clientId, "env-id", "IGDB still comes from the environment");

    // Sending the mask back keeps the secret; clearing a field falls back to the environment.
    await app.inject({ method: "PUT", url: "/api/settings/integrations", headers, payload: { rawg: { apiKey: "********" }, publicUrl: "" } });
    assert.equal(config.rawg.apiKey, "rawg-key");
    assert.equal(config.publicUrl, "");
    const providers = (await app.inject({ url: "/api/auth/providers" })).json();
    assert.equal(providers.oidc.enabled, false, "sign-on needs a public address");

    const bad = await app.inject({ method: "PUT", url: "/api/settings/integrations", headers, payload: { publicUrl: "games.local" } });
    assert.equal(bad.statusCode, 400);
    await app.close();
  });

  it("tests RAWG and uses it for metadata, with SteamGridDB covers", async () => {
    const f = fake((url) => {
      if (url.host === "api.rawg.io" && url.pathname === "/api/games") return { body: { results: [{ id: 1, name: "The Sims 4", released: "2014-09-02", background_image: "https://media.rawg.io/sims.jpg" }] } };
      if (url.host === "api.rawg.io" && url.pathname === "/api/games/1")
        return {
          body: {
            id: 1, name: "The Sims 4", released: "2014-09-02", background_image: "https://media.rawg.io/sims.jpg", description_raw: "Life sim.",
            rating: 3.9, metacritic: 70, genres: [{ name: "Simulation" }], esrb_rating: { slug: "teen" },
          },
        };
      if (url.host === "store.steampowered.com") return { body: { items: [] } };
      if (url.host === "www.steamgriddb.com" && url.pathname.startsWith("/api/v2/search/autocomplete/")) return { body: { success: true, data: [{ id: 99, name: "The Sims 4" }] } };
      if (url.host === "www.steamgriddb.com" && url.pathname === "/api/v2/grids/game/99")
        return { body: { success: true, data: [{ url: "https://cdn2.steamgriddb.com/grid/sims.png", thumb: "https://cdn2.steamgriddb.com/thumb/sims.png", width: 600, height: 900 }] } };
      if (url.host === "cdn2.steamgriddb.com") return { body: PNG };
      return undefined;
    });
    const { app, ctx } = await makeApp(root, { apiToken: "svc", rawg: { apiKey: "k" }, steamgriddb: { apiKey: "g" } }, { fetchImpl: f.impl });
    const headers = { authorization: "Bearer svc" };
    const test = await app.inject({ method: "POST", url: "/api/settings/integrations/rawg/test", headers });
    assert.equal(test.statusCode, 200);
    assert.match(test.json().message, /RAWG found 1/);

    const [sims] = ctx.library.list({ search: "sims" });
    await ctx.metadata.autoMatch(sims!.id);
    const game = ctx.library.get(sims!.id)!;
    assert.equal(game.metadata?.provider, "rawg");
    assert.equal(game.metadata?.coverUrl, "https://cdn2.steamgriddb.com/grid/sims.png");
    assert.deepEqual(game.metadata?.ageRatings, [{ organization: "ESRB", rating: "T" }]);
    assert.equal(game.kidSafe, false);
    const cover = await app.inject({ url: game.coverUrl!, headers });
    assert.equal(cover.statusCode, 200);
    assert.equal(cover.headers["content-type"], "image/png");
    await app.close();
  });
});

describe("custom artwork", () => {
  it("lets admins upload a cover, point the background at a URL, and reset both", async () => {
    const f = fake((url) => (url.host === "img.example.com" ? { body: PNG, type: "image/webp" } : undefined));
    const { app, ctx } = await makeApp(root, { apiToken: "svc" }, { fetchImpl: f.impl });
    const headers = { authorization: "Bearer svc" };
    const [game] = ctx.library.list({});
    assert.equal(game!.coverUrl, null);

    const up = await app.inject({ method: "PUT", url: `/api/games/${game!.id}/artwork/cover`, headers: { ...headers, "content-type": "image/png" }, payload: Buffer.from(PNG) });
    assert.equal(up.statusCode, 200);
    assert.match(up.json().coverUrl, /^\/api\/games\/\w+\/cover\?v=\w{8}$/);
    const img = await app.inject({ url: up.json().coverUrl, headers });
    assert.equal(img.headers["content-type"], "image/png");
    assert.deepEqual(new Uint8Array(img.rawPayload), PNG);

    const bg = await app.inject({ method: "PUT", url: `/api/games/${game!.id}/artwork/background`, headers, payload: { url: "https://img.example.com/hero.webp" } });
    assert.equal(bg.json().overrides.background, "https://img.example.com/hero.webp");
    const hero = await app.inject({ url: bg.json().backgroundUrl, headers });
    assert.equal(hero.headers["content-type"], "image/webp");

    const notImage = await app.inject({ method: "PUT", url: `/api/games/${game!.id}/artwork/cover`, headers, payload: { url: "file:///etc/passwd" } });
    assert.equal(notImage.statusCode, 400);

    const reset = await app.inject({ method: "DELETE", url: `/api/games/${game!.id}/artwork/cover`, headers });
    assert.equal(reset.json().coverUrl, null);

    const user = await ctx.users.create({ username: "player", password: "password1" });
    const asUser = { authorization: `Bearer ${ctx.auth.createApiToken(user.id, "t").token}` };
    assert.equal((await app.inject({ method: "DELETE", url: `/api/games/${game!.id}/artwork/background`, headers: asUser })).statusCode, 403);
    await app.close();
  });
});

describe("client downloads", () => {
  it("hosts uploaded app files and fetches a GitHub release", async () => {
    const f = fake((url) => {
      if (url.host === "api.github.com")
        return {
          body: {
            tag_name: "v0.3.0",
            assets: [
              { name: "GameManager-0.3.0-win-x64.exe", browser_download_url: "https://github.com/dl/win.exe" },
              { name: "GameManager-0.3.0-linux-x86_64.AppImage", browser_download_url: "https://github.com/dl/linux.AppImage" },
              { name: "checksums.txt", browser_download_url: "https://github.com/dl/sums" },
            ],
          },
        };
      if (url.host === "github.com") return { body: new Uint8Array([1, 2, 3]), type: "application/octet-stream" };
      return undefined;
    });
    const { app, ctx } = await makeApp(root, { apiToken: "svc" }, { fetchImpl: f.impl });
    const headers = { authorization: "Bearer svc" };
    const user = await ctx.users.create({ username: "dl", password: "password1" });
    const asUser = { authorization: `Bearer ${ctx.auth.createApiToken(user.id, "t").token}` };

    const up = await app.inject({ method: "PUT", url: "/api/clients/gm.exe", headers: { ...headers, "content-type": "application/octet-stream" }, payload: Buffer.from("MZ-binary") });
    assert.equal(up.statusCode, 200);
    assert.equal(up.json().kind, "Command-line client");
    const bad = await app.inject({ method: "PUT", url: "/api/clients/notes.txt", headers: { ...headers, "content-type": "application/octet-stream" }, payload: Buffer.from("x") });
    assert.equal(bad.statusCode, 400);
    assert.equal((await app.inject({ method: "PUT", url: "/api/clients/x.exe", headers: { ...asUser, "content-type": "application/octet-stream" }, payload: Buffer.from("x") })).statusCode, 403);

    const gh = await app.inject({ method: "POST", url: "/api/clients/github", headers, payload: { repo: "someone/game-manager" } });
    assert.equal(gh.statusCode, 200);
    assert.deepEqual(gh.json(), { tag: "v0.3.0", files: ["GameManager-0.3.0-win-x64.exe", "GameManager-0.3.0-linux-x86_64.AppImage"] });

    const list = (await app.inject({ url: "/api/clients", headers: asUser })).json();
    assert.deepEqual(
      list.map((c: { name: string; platform: string }) => [c.name, c.platform]),
      [
        ["GameManager-0.3.0-win-x64.exe", "windows"],
        ["gm.exe", "windows"],
        ["GameManager-0.3.0-linux-x86_64.AppImage", "linux"],
      ],
    );
    const dl = await app.inject({ url: "/api/clients/gm.exe", headers: asUser });
    assert.equal(dl.body, "MZ-binary");
    assert.equal((await app.inject({ url: "/api/clients/..%2F..%2Fgame-manager.db", headers: asUser })).statusCode, 400);
    await app.close();
  });
});
