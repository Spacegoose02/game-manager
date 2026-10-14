import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { buildApp, loadConfig, openDatabase } from "@lootden/server/lib";
import { GameServerClient } from "../src/api.js";
import { findSevenZip } from "../src/extractor.js";
import { listInstalled } from "../src/installed.js";
import { installGame } from "../src/installer.js";
import { applyUpdate, BACKUP_FOLDER, undoUpdate, UpdateMismatchError } from "../src/updates.js";

let work: string;
before(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), "lootden-updates-"));
});
after(() => rm(work, { recursive: true, force: true }));

const read = (p: string) => readFile(p, "utf8");
const gone = (p: string) => stat(p).then(() => false, () => true);

describe("applying updates to an installed game", () => {
  it("copies an update over the game with a backup, refuses a second go, and undoes it", async () => {
    const games = path.join(work, "games");
    await mkdir(path.join(games, "Hades v1.0", "content"), { recursive: true });
    await writeFile(path.join(games, "Hades v1.0", "Hades.exe"), "old exe");
    await writeFile(path.join(games, "Hades v1.0", "content", "a.txt"), "a1");
    // The update is wrapped in its own folder, as patches often are.
    const patch = path.join(work, "src", "Hades Update v1.1");
    await mkdir(path.join(patch, "content"), { recursive: true });
    await writeFile(path.join(patch, "Hades.exe"), "new exe");
    await writeFile(path.join(patch, "content", "a.txt"), "a2");
    await writeFile(path.join(patch, "content", "b.txt"), "b");
    execFileSync((await findSevenZip(""))!.path, ["a", "-tzip", path.join(games, "Hades Update v1.1.zip"), patch], { stdio: "ignore" });
    await mkdir(path.join(games, "Updates", "Hades v1.5 to v1.6 Patch"), { recursive: true });
    await writeFile(path.join(games, "Updates", "Hades v1.5 to v1.6 Patch", "Hades.exe"), "1.6 exe");
    await writeFile(path.join(games, "Updates", "hades_patch_v1.2.exe"), "patcher");

    const built = buildApp({ ...loadConfig({}), gamesDir: games, dataDir: path.join(work, "data"), apiToken: "t0ken", logLevel: "silent" }, openDatabase(":memory:"));
    await built.ctx.library.rescan();
    const address = await built.app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const api = new GameServerClient({ serverUrl: address, apiToken: "t0ken" });
      const [hades] = await api.listGames();
      const updates = await api.json<Array<{ id: string; title: string; baseGameId: string | null }>>("/api/games?kind=update");
      assert.ok(updates.every((u) => u.baseGameId === hades!.id), "all three updates belong to Hades");
      const byTitle = (t: string) => updates.find((u) => u.title === t)!.id;

      const pc = path.join(work, "pc");
      const dir = await installGame(api, hades!.id, { installDir: pc, keepArchives: false, sevenZipPath: "", report: false });
      let [installed] = await listInstalled([pc]);
      assert.equal(installed!.version, "1.0");

      const opts = { workDir: path.join(work, "tmp"), sevenZipPath: "" };
      const applied = await applyUpdate(api, byTitle("Hades Update v1.1"), installed!, opts);
      assert.deepEqual([applied.mode, applied.replaced, applied.added], ["files", 2, 1]);
      assert.equal(await read(path.join(dir, "Hades.exe")), "new exe", "the wrapper folder was skipped");
      assert.equal(await read(path.join(dir, "content", "a.txt")), "a2");
      assert.equal(await read(path.join(dir, "content", "b.txt")), "b");
      assert.equal(await read(path.join(dir, BACKUP_FOLDER, applied.id, "files", "Hades.exe")), "old exe");
      assert.ok(await gone(path.join(work, "tmp", `update-${applied.id}`)), "the download is cleaned up");
      [installed] = await listInstalled([pc]);
      assert.equal(installed!.version, "1.1");
      assert.equal(installed!.updates!.length, 1);

      await assert.rejects(applyUpdate(api, applied.id, installed!, opts), UpdateMismatchError, "already applied");
      // Made for 1.5, and this copy is 1.1.
      await assert.rejects(applyUpdate(api, byTitle("Hades v1.5 to v1.6 Patch"), installed!, opts), /for version 1\.5, but version 1\.1/);

      await undoUpdate(installed!, applied.id);
      assert.equal(await read(path.join(dir, "Hades.exe")), "old exe");
      assert.equal(await read(path.join(dir, "content", "a.txt")), "a1");
      assert.ok(await gone(path.join(dir, "content", "b.txt")));
      assert.ok(await gone(path.join(dir, BACKUP_FOLDER, applied.id)));
      [installed] = await listInstalled([pc]);
      assert.equal(installed!.version, "1.0");
      assert.deepEqual(installed!.updates, []);

      // A patcher program is run against the game's folder instead of being copied in.
      const runs: Array<{ setup: string; target: string }> = [];
      await assert.rejects(applyUpdate(api, byTitle("hades patch v1.2"), installed!, opts), /setup program/);
      const ran = await applyUpdate(api, byTitle("hades patch v1.2"), installed!, { ...opts, runInstaller: async (setup, target) => void runs.push({ setup, target }) });
      assert.equal(ran.mode, "installer");
      assert.equal(runs.length, 1);
      assert.equal(runs[0]!.target, dir);
      assert.equal(path.basename(runs[0]!.setup), "hades_patch_v1.2.exe");
      [installed] = await listInstalled([pc]);
      assert.equal(installed!.version, "1.2");
      await assert.rejects(undoUpdate(installed!, ran.id), /setup program/);
    } finally {
      await built.app.close();
    }
  });
});
