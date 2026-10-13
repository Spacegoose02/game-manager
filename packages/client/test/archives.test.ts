import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { archiveKindOf, groupArchiveSets, safeFolderName } from "@lootden/shared";

describe("archive detection", () => {
  it("recognises archives and split volumes", () => {
    assert.equal(archiveKindOf("a.zip"), "zip");
    assert.equal(archiveKindOf("a.7z.002"), "7z");
    assert.equal(archiveKindOf("a.r05"), "rar");
    assert.equal(archiveKindOf("a.part3.rar"), "rar");
    assert.equal(archiveKindOf("setup.exe"), undefined);
  });

  it("groups split archives so each set is extracted once", () => {
    const sets = groupArchiveSets([
      "gta.part1.rar",
      "gta.part2.rar",
      "gta.part10.rar",
      "old.rar",
      "old.r00",
      "old.r01",
      "big.7z.001",
      "big.7z.002",
      "single.zip",
      "split.zip",
      "split.z01",
      "sub/inner.7z",
    ]);
    const byFirst = Object.fromEntries(sets.map((s) => [s.first, s.volumes]));
    assert.deepEqual(byFirst["gta.part1.rar"], ["gta.part1.rar", "gta.part10.rar", "gta.part2.rar"]);
    assert.deepEqual(byFirst["old.rar"], ["old.r00", "old.r01", "old.rar"]);
    assert.deepEqual(byFirst["big.7z.001"], ["big.7z.001", "big.7z.002"]);
    assert.deepEqual(byFirst["single.zip"], ["single.zip"]);
    assert.deepEqual(byFirst["split.zip"], ["split.z01", "split.zip"]);
    assert.deepEqual(byFirst["sub/inner.7z"], ["sub/inner.7z"]);
    assert.equal(sets.length, 6);
  });

  it("ignores orphan volumes with no first part", () => {
    assert.deepEqual(groupArchiveSets(["x.part2.rar"]), []);
  });
});

describe("safeFolderName", () => {
  it("strips characters Windows rejects", () => {
    assert.equal(safeFolderName('Grand Theft Auto: Vice City "Deluxe"?'), "Grand Theft Auto Vice City Deluxe");
    assert.equal(safeFolderName("CON"), "game-CON");
    assert.equal(safeFolderName("Trailing dots..."), "Trailing dots");
  });
});
