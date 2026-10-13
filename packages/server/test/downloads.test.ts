import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { mapPath } from "../src/connectors/manager.js";
import { makeApp, makeLibrary } from "./helpers.js";

let root: string;
let downloads: string;
before(async () => {
  root = await makeLibrary();
  downloads = await mkdtemp(path.join(os.tmpdir(), "gm-dl-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(downloads, { recursive: true, force: true });
});

/** Fake qBittorrent, SABnzbd and Prowlarr behind one fetch. */
function fakeServices() {
  const torrents: Array<Record<string, unknown>> = [];
  const sabQueue: Array<Record<string, unknown>> = [];
  const sabHistory: Array<Record<string, unknown>> = [];
  const added: string[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const form = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(typeof init.body === "string" ? init.body : "");
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.host === "qbit:8080") {
      if (url.pathname === "/api/v2/auth/login") {
        return form.get("password") === "adminpass" ? new Response("Ok.", { headers: { "set-cookie": "SID=abc; HttpOnly; path=/" } }) : new Response("Fails.");
      }
      if ((init.headers as Record<string, string>)?.Cookie !== "SID=abc") return new Response("Forbidden", { status: 403 });
      if (url.pathname === "/api/v2/app/version") return new Response("v5.1.0");
      if (url.pathname === "/api/v2/torrents/add") {
        added.push(`qbit:${form.get("urls")}|${form.get("category")}|${form.get("tags")}`);
        torrents.push({ hash: "h1", name: "Cool Game", size: 100, progress: 0.4, dlspeed: 5000, eta: 60, state: "downloading", category: form.get("category"), tags: form.get("tags"), content_path: "/data/torrents/games/Cool Game" });
        return new Response("Ok.");
      }
      if (url.pathname === "/api/v2/torrents/info") return json(torrents);
      if (url.pathname === "/api/v2/torrents/stop") {
        torrents[0]!.state = "stoppedDL";
        return new Response("");
      }
      return new Response("not found", { status: 404 });
    }
    if (url.host === "sab:8080") {
      if (url.searchParams.get("apikey") !== "sabkey") return json({ error: "API Key Incorrect" });
      const mode = url.searchParams.get("mode");
      if (mode === "version") return json({ version: "4.4.0" });
      if (mode === "addurl") {
        added.push(`sab:${url.searchParams.get("name")}|${url.searchParams.get("cat")}`);
        sabQueue.push({ nzo_id: "SABnzbd_nzo_1", filename: "Usenet Game", mb: "200", mbleft: "100", percentage: "50", status: "Downloading", timeleft: "0:01:40", cat: "games" });
        return json({ status: true, nzo_ids: ["SABnzbd_nzo_1"] });
      }
      if (mode === "queue") return json({ queue: { slots: sabQueue, kbpersec: "1024" } });
      if (mode === "history") return json({ history: { slots: sabHistory } });
    }
    if (url.host === "prowlarr:9696") {
      if ((init.headers as Record<string, string>)?.["X-Api-Key"] !== "pkey") return json({}, 401);
      if (url.pathname === "/api/v1/system/status") return json({ version: "1.30.0" });
      if (url.pathname === "/api/v1/search") {
        assert.deepEqual(url.searchParams.getAll("categories"), ["4000"]);
        return json([
          { guid: "a", title: "Cool Game-GOG", size: 100, indexer: "Some Tracker", protocol: "torrent", magnetUrl: "magnet:?xt=urn:btih:abc", seeders: 3 },
          { guid: "b", title: "Cool Game NZB", size: 120, indexer: "Some Indexer", protocol: "usenet", downloadUrl: "http://prowlarr:9696/1/download?apikey=x" },
          { guid: "c", title: "Popular Copy", size: 100, indexer: "Other", protocol: "torrent", magnetUrl: "magnet:?xt=urn:btih:def", seeders: 99 },
        ]);
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, torrents, sabQueue, sabHistory, added };
}

const SETTINGS = {
  qbittorrent: { url: "http://qbit:8080/", username: "admin", password: "adminpass", category: "games", savePath: "" },
  sabnzbd: { url: "http://sab:8080", apiKey: "sabkey", category: "games" },
  prowlarr: { url: "http://prowlarr:9696", apiKey: "pkey", categories: [4000] },
  import: { mode: "copy", pathMappings: [] as Array<{ from: string; to: string }> },
};

describe("download connectors", () => {
  it("maps client paths into this container", () => {
    const m = [
      { from: "/data", to: "/mnt/a" },
      { from: "/data/torrents", to: "/downloads" },
    ];
    assert.equal(mapPath("/data/torrents/games/X", m), "/downloads/games/X");
    assert.equal(mapPath("/data/usenet/X", m), "/mnt/a/usenet/X");
    assert.equal(mapPath("/elsewhere/X", m), "/elsewhere/X");
    assert.equal(mapPath("D:\\Downloads\\X", [{ from: "D:/Downloads", to: "/dl" }]), "/dl/X");
  });

  it("saves settings with secrets masked and tests each service", async () => {
    const fake = fakeServices();
    const { app } = await makeApp(root, { apiToken: "svc" }, { fetchImpl: fake.impl });
    const headers = { authorization: "Bearer svc" };
    const saved = (await app.inject({ method: "PUT", url: "/api/connectors", headers, payload: SETTINGS })).json();
    assert.equal(saved.qbittorrent.password, "********");
    assert.equal(saved.qbittorrent.url, "http://qbit:8080");
    // Sending the mask back keeps the real secret.
    await app.inject({ method: "PUT", url: "/api/connectors", headers, payload: { qbittorrent: { ...saved.qbittorrent } } });
    for (const [name, expected] of [["qbittorrent", "qBittorrent v5.1.0"], ["sabnzbd", "SABnzbd 4.4.0"], ["prowlarr", "Prowlarr 1.30.0"]]) {
      const r = await app.inject({ method: "POST", url: `/api/connectors/${name}/test`, headers });
      assert.equal(r.json().message, expected, `${name} test`);
    }
    await app.close();
  });

  it("searches Prowlarr, sends torrents to qBittorrent and copies finished ones into the library", async () => {
    const fake = fakeServices();
    const { app, ctx } = await makeApp(root, { apiToken: "svc" }, { fetchImpl: fake.impl });
    const headers = { authorization: "Bearer svc" };
    const src = path.join(downloads, "torrents", "games", "Cool Game");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "cool.exe"), "game");
    await app.inject({
      method: "PUT",
      url: "/api/connectors",
      headers,
      payload: { ...SETTINGS, import: { mode: "copy", pathMappings: [{ from: "/data/torrents", to: path.join(downloads, "torrents") }] } },
    });

    const results = (await app.inject({ url: "/api/downloads/search?q=cool%20game", headers })).json();
    assert.deepEqual(results.map((r: { guid: string }) => r.guid), ["c", "a", "b"], "most seeders first");
    const grab = await app.inject({ method: "POST", url: "/api/downloads", headers, payload: { url: results[1].downloadUrl, title: results[1].title, protocol: "torrent" } });
    assert.equal(grab.statusCode, 200);
    assert.deepEqual(fake.added, ["qbit:magnet:?xt=urn:btih:abc|games|gm-1"]);

    let list = (await app.inject({ url: "/api/downloads", headers })).json();
    assert.equal(list.downloads[0].live.progress, 0.4);
    assert.equal(list.downloads[0].live.state, "downloading");

    assert.equal((await app.inject({ method: "POST", url: `/api/downloads/${list.downloads[0].id}`, headers, payload: { action: "pause" } })).statusCode, 200);
    assert.equal(fake.torrents[0]!.state, "stoppedDL");

    Object.assign(fake.torrents[0]!, { progress: 1, state: "stalledUP" });
    await ctx.downloads.reconcile();
    list = (await app.inject({ url: "/api/downloads", headers })).json();
    assert.equal(list.downloads[0].status, "imported");
    assert.ok(ctx.library.list({ search: "cool" }).length === 1, "game appears in the library");
    assert.ok(await stat(path.join(src, "cool.exe")), "copy mode leaves the seeding files in place");
    await app.close();
  });

  it("sends usenet results to SABnzbd and moves finished ones", async () => {
    const fake = fakeServices();
    const { app, ctx } = await makeApp(root, { apiToken: "svc" }, { fetchImpl: fake.impl });
    const headers = { authorization: "Bearer svc" };
    const src = path.join(downloads, "complete", "Usenet Game");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "data.7z"), "7z");
    await app.inject({ method: "PUT", url: "/api/connectors", headers, payload: { ...SETTINGS, import: { mode: "move", pathMappings: [] } } });

    const grab = await app.inject({ method: "POST", url: "/api/downloads", headers, payload: { url: "http://prowlarr:9696/1/download?apikey=x", title: "Usenet Game", protocol: "usenet" } });
    assert.equal(grab.json().externalId, "SABnzbd_nzo_1");
    fake.sabQueue.length = 0;
    fake.sabHistory.push({ nzo_id: "SABnzbd_nzo_1", name: "Usenet Game", bytes: 200, status: "Completed", storage: src, category: "games" });
    await ctx.downloads.reconcile();
    assert.equal(ctx.downloads.get(1)!.status, "imported");
    assert.deepEqual(await readdir(path.join(root, "Usenet Game")), ["data.7z"]);
    await assert.rejects(stat(src), "move mode removes the source");
    await app.close();
  });

  it("is admin only and rejects odd URLs", async () => {
    const { app, ctx } = await makeApp(root, { apiToken: "svc" });
    const u = await ctx.users.create({ username: "plain", password: "password1" });
    const token = ctx.auth.createApiToken(u.id, "t").token;
    assert.equal((await app.inject({ url: "/api/downloads", headers: { authorization: `Bearer ${token}` } })).statusCode, 403);
    const bad = await app.inject({ method: "POST", url: "/api/downloads", headers: { authorization: "Bearer svc" }, payload: { url: "file:///etc/passwd", title: "x", protocol: "torrent" } });
    assert.equal(bad.statusCode, 400);
    await app.close();
  });
});
