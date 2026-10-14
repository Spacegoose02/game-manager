import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { packageInfo } from "@lootden/shared";
import { tidyName } from "../src/connectors/tidy.js";
import { makeApp } from "./helpers.js";

describe("update and DLC names", () => {
  it("tells updates and DLC from full games", () => {
    assert.deepEqual(packageInfo("Cyberpunk.2077.Update.v2.1-GOG.zip"), { kind: "update", baseTitle: "Cyberpunk 2077", version: "2.1", fromVersion: null });
    assert.deepEqual(packageInfo("Stardew Valley v1.5 to v1.6 Patch.zip"), { kind: "update", baseTitle: "Stardew Valley", version: "1.6", fromVersion: "1.5" });
    assert.equal(packageInfo("Elden Ring Title Update 3").kind, "update");
    assert.equal(packageInfo("Hollow Knight DLC Godmaster").kind, "dlc");
    assert.equal(packageInfo("Hollow Knight DLC Godmaster").baseTitle, "Hollow Knight");
    // Full games that already include their updates, or are just named that way.
    assert.equal(packageInfo("Game incl Update 3").kind, "game");
    assert.equal(packageInfo("The Sims 4 + 5 DLCs").kind, "game");
    assert.equal(packageInfo("Patch Quest").kind, "game");
    assert.equal(packageInfo("Hades v1.38.zip").kind, "game");
    assert.equal(packageInfo("Hades v1.38.zip").version, "1.38");
    // Imports keep saying they're updates, so they aren't taken for the full game.
    assert.equal(tidyName("Cyberpunk.2077.Update.v2.1-GOG"), "Cyberpunk 2077 Update v2.1");
    assert.equal(tidyName("Stardew.Valley.v1.5.to.v1.6.Patch-GROUP.rar"), "Stardew Valley Update v1.5 to v1.6");
    assert.equal(packageInfo(tidyName("Stardew.Valley.v1.5.to.v1.6.Patch-GROUP.rar")).fromVersion, "1.5");
    // Anything in an Updates folder is an update.
    assert.equal(packageInfo("Hades 1.39 files", "update").kind, "update");
  });
});

describe("update packages in the library", () => {
  let root: string;
  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "lootden-updates-"));
    await mkdir(path.join(root, "Cyberpunk 2077"));
    await writeFile(path.join(root, "Cyberpunk 2077", "Cyberpunk2077.exe"), "exe");
    await writeFile(path.join(root, "Cyberpunk.2077.Update.v2.1-GOG.zip"), "zip");
    await writeFile(path.join(root, "Stardew Valley v1.5.zip"), "zip");
    await mkdir(path.join(root, "Updates"));
    await writeFile(path.join(root, "Updates", "Stardew Valley v1.5 to v1.6 Patch.zip"), "zip");
    await writeFile(path.join(root, "Updates", "patch_stardew_valley_1.6.1.exe"), "exe");
    await mkdir(path.join(root, "DLC"));
    await writeFile(path.join(root, "DLC", "Hollow Knight Godmaster.zip"), "zip");
  });
  after(() => rm(root, { recursive: true, force: true }));

  it("keeps updates out of the library, lists them on their own and matches them to their game", async () => {
    const { ctx, app } = await makeApp(root, { apiToken: "svc" });
    const auth = { authorization: "Bearer svc" };
    await ctx.library.rescan();

    const games = (await app.inject({ url: "/api/games", headers: auth })).json() as Array<{ title: string; kind: string }>;
    assert.deepEqual(games.map((g) => g.title).sort(), ["Cyberpunk 2077", "Stardew Valley v1 5"]);

    const addons = (await app.inject({ url: "/api/games?kind=addon", headers: auth })).json() as Array<{ id: string; title: string; kind: string; baseGameId: string | null; version: string | null; fromVersion: string | null }>;
    const byTitle = new Map(addons.map((a) => [a.title, a]));
    const cyberpunk = games.find((g) => g.title === "Cyberpunk 2077") as unknown as { id: string };
    const stardew = games.find((g) => g.title === "Stardew Valley v1 5") as unknown as { id: string };
    assert.equal(byTitle.get("Cyberpunk 2077 Update v2.1")?.baseGameId, cyberpunk.id);
    assert.equal(byTitle.get("Stardew Valley v1.5 to v1.6 Patch")?.baseGameId, stardew.id);
    assert.equal(byTitle.get("Stardew Valley v1.5 to v1.6 Patch")?.fromVersion, "1.5");
    assert.equal(byTitle.get("Stardew Valley v1.5 to v1.6 Patch")?.version, "1.6");
    assert.equal(byTitle.get("patch stardew valley 1.6.1")?.kind, "update", "a loose setup program in Updates counts");
    const dlc = byTitle.get("Hollow Knight Godmaster")!;
    assert.equal(dlc.kind, "dlc");
    assert.equal(dlc.baseGameId, null, "no Hollow Knight on the server: DLC only");

    // The game page lists its updates; the update page names its game.
    const detail = (await app.inject({ url: `/api/games/${stardew.id}`, headers: auth })).json() as { addons: Array<{ title: string }> };
    assert.ok(detail.addons.some((a) => a.title === "Stardew Valley v1.5 to v1.6 Patch"));
    const patch = byTitle.get("Stardew Valley v1.5 to v1.6 Patch")!;
    const patchDetail = (await app.inject({ url: `/api/games/${patch.id}`, headers: auth })).json() as { baseGame: { id: string } | null; needsSetup: unknown };
    assert.equal(patchDetail.baseGame?.id, stardew.id);

    // An admin can fix a wrong match, and turn a misread entry back into a game.
    const fixed = await app.inject({ method: "PUT", url: `/api/games/${dlc.id}/package`, headers: auth, payload: { baseGameId: cyberpunk.id } });
    assert.equal(fixed.statusCode, 200);
    assert.equal((fixed.json() as { baseGameId: string }).baseGameId, cyberpunk.id);
    const asGame = await app.inject({ method: "PUT", url: `/api/games/${dlc.id}/package`, headers: auth, payload: { kind: "game" } });
    assert.equal((asGame.json() as { kind: string }).kind, "game");
    const after = (await app.inject({ url: "/api/games", headers: auth })).json() as Array<{ title: string }>;
    assert.ok(after.some((g) => g.title === "Hollow Knight Godmaster"));
    const bad = await app.inject({ method: "PUT", url: `/api/games/${patch.id}/package`, headers: auth, payload: { baseGameId: "nope" } });
    assert.equal(bad.statusCode, 400);
    await app.close();
  });
});
