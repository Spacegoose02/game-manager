import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp, loadConfig, openDatabase } from "@lootden/server/lib";
import { GameServerClient } from "../src/api.js";
import { findSevenZip, type SevenZip } from "../src/extractor.js";
import { backupSaves, expandSavePath, restoreSaves } from "../src/saves.js";

let work: string;
let app: FastifyInstance;
let api: GameServerClient;
let sevenZip: SevenZip;
let gameId: string;

before(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), "gm-saves-"));
  await mkdir(path.join(work, "games", "Hades"), { recursive: true });
  await writeFile(path.join(work, "games", "Hades", "Hades.exe"), "x");
  const built = buildApp({ ...loadConfig({}), gamesDir: path.join(work, "games"), dataDir: path.join(work, "data"), logLevel: "silent" }, openDatabase(":memory:"));
  app = built.app;
  await built.ctx.library.rescan();
  const user = await built.ctx.users.create({ username: "player", password: "password1" });
  gameId = built.ctx.library.list({})[0]!.id;
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  api = new GameServerClient({ serverUrl: address, apiToken: built.ctx.auth.createApiToken(user.id, "t").token });
  sevenZip = (await findSevenZip(""))!;
});

after(async () => {
  await app.close();
  await rm(work, { recursive: true, force: true });
});

describe("save sync client", () => {
  it("expands placeholders and picks the newest folder for *", async () => {
    const install = path.join(work, "install", "Hades");
    assert.equal(await expandSavePath("{game}/Saves", install), path.join(install, "Saves"));
    const users = path.join(work, "userdata");
    await mkdir(path.join(users, "111"), { recursive: true });
    await mkdir(path.join(users, "222"), { recursive: true });
    await utimes(path.join(users, "111"), new Date(2020, 1, 1), new Date(2020, 1, 1));
    assert.equal(await expandSavePath(`${users}/*/remote`, install), path.join(users, "222", "remote"));
    process.env.GM_TEST_SAVES = work;
    assert.equal(await expandSavePath("%GM_TEST_SAVES%/x", install), path.join(work, "x"));
    await assert.rejects(expandSavePath("%GM_NOT_SET_ANYWHERE%/x", install), /isn't set/);
  });

  it("backs up, then restores while keeping the old saves", async () => {
    const saveDir = path.join(work, "saves", "Hades");
    await mkdir(path.join(saveDir, "Profile1"), { recursive: true });
    await writeFile(path.join(saveDir, "Profile1", "slot.sav"), "level 12");
    const backup = await backupSaves(api, sevenZip, gameId, saveDir, "desktop");
    assert.equal(backup.device, "desktop");
    assert.equal((await api.listSaves(gameId)).length, 1);

    await writeFile(path.join(saveDir, "Profile1", "slot.sav"), "level 1 on the laptop");
    const { previous } = await restoreSaves(api, sevenZip, gameId, backup.id, saveDir);
    assert.equal(await readFile(path.join(saveDir, "Profile1", "slot.sav"), "utf8"), "level 12");
    assert.equal(await readFile(path.join(previous!, "Profile1", "slot.sav"), "utf8"), "level 1 on the laptop");
    assert.ok((await readdir(path.dirname(saveDir))).some((n) => n.startsWith("Hades.gm-backup-")));
  });
});
