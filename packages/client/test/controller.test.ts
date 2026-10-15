import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { bindController } from "../src/emulators.js";

const setup = {
  pad: { section: "Pad1", values: { Type: "AnalogController", Cross: "SDL-0/A" } },
  extra: [{ section: "InputSources", values: { SDL: "true" } }],
};

describe("emulator controllers", () => {
  it("puts the first controller on player 1 in a fresh settings file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gm-pad-"));
    const file = path.join(dir, "settings.ini");
    await writeFile(file, "[MemoryCards]\nCard1Type = PerGameFileTitle\n");
    assert.equal(await bindController(file, setup), true);
    const ini = await readFile(file, "utf8");
    assert.match(ini, /\[MemoryCards\]\nCard1Type = PerGameFileTitle/);
    assert.match(ini, /\[InputSources\]\nSDL = true/);
    assert.match(ini, /\[Pad1\]\nType = AnalogController\nCross = SDL-0\/A/);
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps a controller the player bound themselves", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gm-pad-"));
    const file = path.join(dir, "settings.ini");
    const mine = "[Pad1]\nType = DigitalController\nCross = XInput-0/B\n";
    await writeFile(file, mine);
    assert.equal(await bindController(file, setup), false);
    assert.equal(await readFile(file, "utf8"), mine);
    // Keyboard-only bindings are the emulator's defaults, so the controller is added.
    await writeFile(file, "[Pad1]\nType = AnalogController\nCross = Keyboard/X\n");
    assert.equal(await bindController(file, setup), true);
    assert.match(await readFile(file, "utf8"), /Cross = SDL-0\/A/);
    await rm(dir, { recursive: true, force: true });
  });
});
