import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp, loadConfig, openDatabase } from "@lootden/server/lib";
import { GameServerClient } from "../src/api.js";
import { findSevenZip, type SevenZip } from "../src/extractor.js";
import { findSetup, prepareGame } from "../src/prepare.js";

let work: string;
let app: FastifyInstance;
let api: GameServerClient;
let sevenZip: SevenZip;

before(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), "gm-prep-"));
  const games = path.join(work, "games");
  await mkdir(path.join(games, "Repack Game"), { recursive: true });
  await writeFile(path.join(games, "Repack Game", "setup.exe"), "MZ fake installer");
  await writeFile(path.join(games, "Repack Game", "data-01.bin"), "payload");
  const built = buildApp({ ...loadConfig({}), gamesDir: games, dataDir: path.join(work, "data"), apiToken: "t0ken", logLevel: "silent" }, openDatabase(":memory:"));
  app = built.app;
  await built.ctx.library.rescan();
  api = new GameServerClient({ serverUrl: await app.listen({ host: "127.0.0.1", port: 0 }), apiToken: "t0ken" });
  sevenZip = (await findSevenZip(""))!;
});
after(async () => {
  await app.close();
  await rm(work, { recursive: true, force: true });
});

describe("preparing installer games", () => {
  it("finds the setup program, preferring autorun.inf", async () => {
    const disc = path.join(work, "disc");
    await mkdir(path.join(disc, "Bin"), { recursive: true });
    await writeFile(path.join(disc, "Bin", "Launch.exe"), "x");
    await writeFile(path.join(disc, "setup.exe"), "x");
    assert.equal(await findSetup(disc), path.join(disc, "setup.exe"));
    await writeFile(path.join(disc, "AUTORUN.INF"), "[autorun]\r\nopen=Bin\\Launch.exe\r\nicon=x.ico\r\n");
    assert.equal(await findSetup(disc), path.join(disc, "Bin", "Launch.exe"));
  });

  it("runs the installer, zips what it installed and swaps the game on the server", async () => {
    const [game] = await api.listGames();
    assert.equal(game!.needsSetup, "installer");
    const steps: string[] = [];
    let ranWith: string[] = [];
    const prepared = await prepareGame(api, game!.id, {
      workDir: path.join(work, "prep"),
      sevenZip,
      version: "2.0",
      onStep: (s) => steps.push(s.step),
      runInstaller: async (setup, target, args) => {
        ranWith = [path.basename(setup), ...args];
        await mkdir(path.join(target, "bin"), { recursive: true });
        await writeFile(path.join(target, "bin", "game.exe"), "installed game");
      },
      confirmInstalled: async (suggested) => suggested,
    });
    assert.deepEqual(ranWith, ["setup.exe"]);
    assert.equal(prepared!.source, "Repack Game v2.0.zip");
    assert.equal(prepared!.needsSetup, null);
    assert.ok(steps.includes("zip") && steps.includes("upload") && steps.at(-1) === "done");
    assert.deepEqual(await readdir(path.join(work, "games")).then((n) => n.filter((x) => !x.startsWith("."))), ["Repack Game v2.0.zip"]);
    await assert.rejects(readdir(path.join(work, "prep")), "scratch folder is cleaned up");
  });
});
