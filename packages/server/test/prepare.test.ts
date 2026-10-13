import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { setupKindOf } from "@lootden/shared";
import { makeApp } from "./helpers.js";

let root: string;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "gm-prepare-"));
  await mkdir(path.join(root, "Old Game (Disc)"));
  await writeFile(path.join(root, "Old Game (Disc)", "OLDGAME.iso"), "iso");
  await mkdir(path.join(root, "Repack Game"));
  await writeFile(path.join(root, "Repack Game", "setup.exe"), "exe");
  await writeFile(path.join(root, "Repack Game", "data-01.bin"), "bin");
});
after(() => rm(root, { recursive: true, force: true }));

describe("disc and installer games", () => {
  it("spots discs and installers", () => {
    assert.equal(setupKindOf([{ path: "game.iso" }]), "disc");
    assert.equal(setupKindOf([{ path: "Game/setup.exe" }, { path: "Game/setup-1.bin" }]), "installer");
    assert.equal(setupKindOf([{ path: "setup_game_1.0.exe" }]), "installer");
    assert.equal(setupKindOf([{ path: "bin/game.exe" }, { path: "data/a.pak" }, { path: "readme.txt" }]), null);
  });

  it("replaces a disc game with the uploaded install and keeps its data", async () => {
    const { app, ctx } = await makeApp(root, { apiToken: "svc" });
    const headers = { authorization: "Bearer svc" };
    const disc = ctx.library.list({}).find((g) => g.needsSetup === "disc")!;
    assert.equal(ctx.library.list({}).find((g) => g.source === "Repack Game")!.needsSetup, "installer");
    ctx.library.setOverrides(disc.id, { title: "Old Game" });
    const user = await ctx.users.create({ username: "player", password: "password1" });
    const asUser = { authorization: `Bearer ${ctx.auth.createApiToken(user.id, "t").token}` };
    const upload = (h: object, body = "PK-installed") =>
      app.inject({ method: "PUT", url: `/api/games/${disc.id}/prepared?version=1.1`, headers: { ...h, "content-type": "application/octet-stream" }, payload: Buffer.from(body) });

    assert.equal((await upload(asUser)).statusCode, 403);
    const res = await upload(headers);
    assert.equal(res.statusCode, 200, res.body);
    const game = res.json();
    assert.equal(game.source, "Old Game v1.1.zip");
    assert.equal(game.title, "Old Game", "title override carried over");
    assert.equal(game.needsSetup, null);
    assert.equal(ctx.library.get(disc.id), undefined);
    assert.deepEqual((await readdir(path.join(root, ".replaced"))).map((n) => n.replace(/^\d+-/, "")), ["Old Game (Disc)"]);
    assert.equal((await upload(headers)).statusCode, 404, "the old id is gone");
    await app.close();
  });
});
