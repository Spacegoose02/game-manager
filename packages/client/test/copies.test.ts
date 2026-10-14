import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { buildApp, loadConfig, openDatabase } from "@lootden/server/lib";
import { GameServerClient } from "../src/api.js";
import { findSevenZip } from "../src/extractor.js";
import { adoptFolder, findCopies, listInstalled } from "../src/installed.js";
import { installGame, MANIFEST_NAME } from "../src/installer.js";

let work: string;
before(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), "gm-copies-"));
});
after(() => rm(work, { recursive: true, force: true }));

const manifest = async (dir: string) => JSON.parse(await readFile(path.join(dir, MANIFEST_NAME), "utf8"));

describe("installers and copies already on this PC", () => {
  it("spots an installer that was zipped up, once it's unpacked", async () => {
    const games = path.join(work, "games");
    const staging = path.join(work, "staging", "Occupy Mars");
    await mkdir(staging, { recursive: true });
    for (const f of ["setup.exe", "fg-01.bin", "fg-02.bin"]) await writeFile(path.join(staging, f), f);
    await mkdir(games, { recursive: true });
    execFileSync((await findSevenZip(""))!.path, ["a", "-tzip", path.join(games, "Occupy Mars.zip"), staging], { stdio: "ignore" });
    const built = buildApp({ ...loadConfig({}), gamesDir: games, dataDir: path.join(work, "data"), apiToken: "t0ken", logLevel: "silent" }, openDatabase(":memory:"));
    await built.ctx.library.rescan();
    const address = await built.app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const api = new GameServerClient({ serverUrl: address, apiToken: "t0ken" });
      const [game] = await api.listGames();
      assert.equal(game!.needsSetup, null, "the server only sees the zip");
      const dir = await installGame(api, game!.id, { installDir: path.join(work, "pc"), keepArchives: false, sevenZipPath: "", report: false });
      assert.equal((await manifest(dir)).needsSetup, "installer");
      assert.equal((await listInstalled([path.join(work, "pc")]))[0]!.needsSetup, "installer");
    } finally {
      await built.app.close();
    }
  });

  it("checks installs from older apps once and remembers the answer", async () => {
    const root = path.join(work, "old");
    await mkdir(path.join(root, "Repack"), { recursive: true });
    await writeFile(path.join(root, "Repack", "setup.exe"), "x");
    await writeFile(path.join(root, "Repack", "data-1.bin"), "x");
    await writeFile(path.join(root, "Repack", MANIFEST_NAME), JSON.stringify({ gameId: "g1", title: "Repack", platform: "pc" }));
    await mkdir(path.join(root, "Normal"), { recursive: true });
    await writeFile(path.join(root, "Normal", "Normal.exe"), "x");
    await writeFile(path.join(root, "Normal", MANIFEST_NAME), JSON.stringify({ gameId: "g2", title: "Normal", platform: "pc" }));
    const list = await listInstalled([root]);
    assert.equal(list.find((g) => g.gameId === "g1")!.needsSetup, "installer");
    assert.equal(list.find((g) => g.gameId === "g2")!.needsSetup, null);
    assert.equal((await manifest(path.join(root, "Repack"))).needsSetup, "installer");
  });

  it("finds an install under its old id, and folders without a manifest", async () => {
    const root = path.join(work, "lib");
    await mkdir(path.join(root, "Hades"), { recursive: true });
    await writeFile(path.join(root, "Hades", "Hades.exe"), "x");
    await writeFile(path.join(root, "Hades", MANIFEST_NAME), JSON.stringify({ gameId: "old-id", title: "Hades", source: "Hades", platform: "pc" }));
    const hades = { id: "new-id", title: "Hades", source: "Hades.zip", platform: "pc" };

    const found = await findCopies([root, path.join(work, "missing")], hades);
    assert.equal(found.relinked, true);
    assert.equal(found.installed!.dir, path.join(root, "Hades"));
    assert.equal((await manifest(path.join(root, "Hades"))).gameId, "new-id");
    assert.equal((await findCopies([root], hades)).relinked, false, "linked now, found by id");

    await mkdir(path.join(root, "Celeste"), { recursive: true });
    await writeFile(path.join(root, "Celeste", "Celeste.exe"), "x");
    const celeste = { id: "c1", title: "Celeste", source: "Celeste", platform: "pc" };
    const loose = await findCopies([root], celeste);
    assert.equal(loose.installed, null);
    assert.deepEqual(loose.loose, [path.join(root, "Celeste")]);
    const adopted = await adoptFolder(loose.loose[0]!, celeste);
    assert.equal(adopted.gameId, "c1");
    assert.equal(adopted.needsSetup, null);
    assert.equal((await findCopies([root], celeste)).installed!.dir, path.join(root, "Celeste"));
  });
});
