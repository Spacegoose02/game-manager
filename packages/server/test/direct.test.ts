import assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { dispositionName, parseLinks, resolveLink } from "../src/direct/hosts.js";
import { packageNameFrom } from "../src/direct/manager.js";
import { makeApp, makeLibrary } from "./helpers.js";

let root: string;
before(async () => {
  root = await makeLibrary();
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

// Real RAR volumes start with this signature; the downloader checks it.
const PART1 = "Rar!\x1a\x07\x01\x00first-part-bytes";
const PART2 = "Rar!\x1a\x07\x01\x00second-part";

/** Fake MediaFire, Datanodes and Pixeldrain behind one fetch. */
function fakeHosts() {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push(`${method} ${url}`);
    const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    const file = (body: string, name?: string) => {
      const range = (init.headers as Record<string, string> | undefined)?.Range?.match(/bytes=(\d+)-/);
      const from = range ? Number(range[1]) : 0;
      return new Response(body.slice(from), {
        status: from ? 206 : 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(body.length - from),
          ...(from ? { "content-range": `bytes ${from}-${body.length - 1}/${body.length}` } : {}),
          ...(name ? { "content-disposition": `attachment; filename="${name}"` } : {}),
        },
      });
    };
    if (url.hostname === "www.mediafire.com") {
      if (url.pathname.includes("gone")) return new Response("nope", { status: 404 });
      const direct = "https://download2391.mediafire.com/abc/xyz/Cool.Game.part1.rar";
      return html(
        `<div class="filename">Cool.Game.part1.rar</div><a class="input popsok" aria-label="Download file" href="${direct}" id="downloadButton" rel="nofollow">Download (0.01MB)</a>` +
          `<a id="other" data-scrambled-url="${Buffer.from("https://x").toString("base64")}"></a>`,
      );
    }
    if (url.hostname === "download2391.mediafire.com") return file(PART1);
    if (url.hostname === "datanodes.to" && method === "POST") {
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("op"), "download2");
      assert.equal(body.get("id"), "k3j2h1");
      return new Response(null, { status: 302, headers: { location: "https://dl.datanodes.to/d/k3j2h1/Cool.Game.part2.rar" } });
    }
    if (url.hostname === "dl.datanodes.to") return file(PART2);
    if (url.hostname === "pixeldrain.com" && url.pathname.endsWith("/info")) return Response.json({ name: "readme.txt", size: 3 });
    if (url.hostname === "pixeldrain.com") return file("hey", "readme.txt");
    if (url.hostname === "files.example.com") return file("direct", "Direct.zip");
    if (url.hostname === "empty.example.com") return file("", "Empty.Game.rar");
    if (url.hostname === "errors.example.com") return file("Sorry, quota exceeded", "Quota.Game.rar");
    if (url.hostname === "blog.example.com") return html("<p>Just a page</p>");
    throw new Error(`Unexpected ${method} ${url}`);
  }) as typeof fetch;
  return { impl, calls };
}

describe("download manager links", () => {
  it("finds links in pasted text and names games from their files", () => {
    assert.deepEqual(parseLinks("grab these:\nhttps://a.com/x (part 1)\n https://b.com/y, https://a.com/x"), ["https://a.com/x", "https://b.com/y"]);
    assert.equal(packageNameFrom("Cool.Game.v1.2.part01.rar"), "Cool.Game.v1.2");
    assert.equal(packageNameFrom("Thing.7z.001"), "Thing");
    assert.equal(dispositionName(`attachment; filename*=UTF-8''Caf%C3%A9.zip`), "Café.zip");
  });

  it("resolves MediaFire, Datanodes, Pixeldrain and plain links", async () => {
    const { impl } = fakeHosts();
    const mf = await resolveLink("https://www.mediafire.com/file/abc123/Cool.Game.part1.rar/file", impl);
    assert.equal(mf.host, "MediaFire");
    assert.equal(mf.url, "https://download2391.mediafire.com/abc/xyz/Cool.Game.part1.rar");
    assert.equal(mf.fileName, "Cool.Game.part1.rar");
    const dn = await resolveLink("https://datanodes.to/k3j2h1/Cool.Game.part2.rar", impl);
    assert.equal(dn.host, "Datanodes");
    assert.equal(dn.url, "https://dl.datanodes.to/d/k3j2h1/Cool.Game.part2.rar");
    assert.equal(dn.fileName, "Cool.Game.part2.rar");
    const px = await resolveLink("https://pixeldrain.com/u/AbC12", impl);
    assert.equal(px.url, "https://pixeldrain.com/api/file/AbC12?download");
    assert.equal(px.fileName, "readme.txt");
    const plain = await resolveLink("https://files.example.com/get?id=5", impl);
    assert.equal(plain.host, "Direct link");
    assert.equal(plain.fileName, "Direct.zip");
    await assert.rejects(resolveLink("https://blog.example.com/post", impl), /web page, not a file/);
    await assert.rejects(resolveLink("https://gofile.io/d/abc", impl), /Gofile needs an account/);
    await assert.rejects(resolveLink("https://www.mediafire.com/file/gone/x/file", impl), /doesn't exist/);
  });

  it("downloads every link of a game and imports it into the library", async () => {
    const { impl } = fakeHosts();
    const { app, ctx } = await makeApp(root, { apiToken: "svc" }, { fetchImpl: impl });
    const headers = { authorization: "Bearer svc" };
    // Plain import (no 7-Zip in tests): the files go in as they are.
    await app.inject({ method: "PUT", url: "/api/connectors", headers, payload: { import: { tidy: { stripJunk: false, extract: false, repack: "folder" } } } });

    const links = "https://www.mediafire.com/file/abc123/Cool.Game.part1.rar/file\nhttps://datanodes.to/k3j2h1/Cool.Game.part2.rar";
    const check = await app.inject({ method: "POST", url: "/api/direct/check", headers, payload: { links: `${links}\nhttps://gofile.io/d/zz` } });
    assert.equal(check.statusCode, 200);
    const checked = check.json() as Array<{ ok: boolean; host: string; fileName: string | null }>;
    assert.deepEqual(checked.map((c) => [c.host, c.ok]), [["MediaFire", true], ["Datanodes", true], ["Gofile", false]]);

    const res = await app.inject({ method: "POST", url: "/api/direct", headers, payload: { links } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().name, "Cool.Game");
    await ctx.direct.idle();

    const list = (await app.inject({ method: "GET", url: "/api/direct", headers })).json() as { hosts: string[]; packages: Array<{ status: string; importedPath: string; files: Array<{ status: string; receivedBytes: number }> }> };
    assert.ok(list.hosts.includes("Datanodes"));
    const pkg = list.packages[0]!;
    assert.equal(pkg.status, "imported", JSON.stringify(pkg));
    assert.deepEqual(pkg.files.map((f) => f.status), ["done", "done"]);
    assert.deepEqual(pkg.files.map((f) => f.receivedBytes), [PART1.length, PART2.length]);
    assert.equal(path.basename(pkg.importedPath), "Cool.Game");
    assert.deepEqual((await readdir(pkg.importedPath)).sort(), ["Cool.Game.part1.rar", "Cool.Game.part2.rar"]);
    assert.equal(await readFile(path.join(pkg.importedPath, "Cool.Game.part2.rar"), "utf8"), PART2);
    // The staging folder is gone and the game is in the library.
    assert.deepEqual(await readdir(path.join(root, ".lootden-direct")), []);
    assert.ok(ctx.library.list().some((g) => g.title.includes("Cool Game") || g.source === "Cool.Game"), "the game shows up in the library");

    // Non-admins can't use it.
    const removed = await app.inject({ method: "POST", url: `/api/direct/${(res.json() as { id: number }).id}`, headers, payload: { action: "remove" } });
    assert.equal(removed.statusCode, 200);
    assert.equal(((await app.inject({ method: "GET", url: "/api/direct", headers })).json() as { packages: unknown[] }).packages.length, 0);
    await app.close();
  });

  it("marks a game failed when a link breaks, and retries it", async () => {
    const { impl } = fakeHosts();
    const { app, ctx } = await makeApp(root, { apiToken: "svc" }, { fetchImpl: impl });
    const headers = { authorization: "Bearer svc" };
    const res = await app.inject({ method: "POST", url: "/api/direct", headers, payload: { links: "https://www.mediafire.com/file/gone/x/file", name: "Broken Game" } });
    await ctx.direct.idle();
    const id = (res.json() as { id: number }).id;
    const pkg = ctx.direct.get(id)!;
    assert.equal(pkg.status, "failed");
    assert.match(pkg.error ?? "", /doesn't exist/);
    assert.equal(pkg.files[0]!.status, "failed");
    const retry = await app.inject({ method: "POST", url: `/api/direct/${id}`, headers, payload: { action: "retry" } });
    assert.equal(retry.statusCode, 200);
    await ctx.direct.idle();
    assert.equal(ctx.direct.get(id)!.status, "failed");
    await app.close();
  });
  it("fails a download that came back empty or isn't really an archive, instead of importing it", async () => {
    const { impl } = fakeHosts();
    const { app, ctx } = await makeApp(root, { apiToken: "svc" }, { fetchImpl: impl });
    const headers = { authorization: "Bearer svc" };
    const before = ctx.library.list().length;
    const empty = await app.inject({ method: "POST", url: "/api/direct", headers, payload: { links: "https://empty.example.com/get?id=1", name: "Empty Game" } });
    const quota = await app.inject({ method: "POST", url: "/api/direct", headers, payload: { links: "https://errors.example.com/get?id=2", name: "Quota Game" } });
    await ctx.direct.idle();
    const a = ctx.direct.get((empty.json() as { id: number }).id)!;
    const b = ctx.direct.get((quota.json() as { id: number }).id)!;
    assert.equal(a.status, "failed");
    assert.match(a.error ?? "", /Empty\.Game\.rar is empty \(0 bytes\)/);
    assert.equal(b.status, "failed");
    assert.match(b.error ?? "", /isn't a RAR archive/);
    assert.equal(ctx.library.list().length, before, "nothing broken reached the library");
    // A retry downloads the file again instead of resuming the bad one.
    await ctx.direct.control(a.id, "retry");
    await ctx.direct.idle();
    assert.equal(ctx.direct.get(a.id)!.status, "failed");
    assert.match(ctx.direct.get(a.id)!.error ?? "", /is empty/);
    await app.close();
  });
});
