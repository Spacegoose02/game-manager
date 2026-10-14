import { withLegacyEnv } from "./config.js";

// LOOTDEN_* variables are the documented names; everything inside still reads GM_*, the
// names from before the rename, so copy the new names over before anything reads them.
Object.assign(process.env, withLegacyEnv(process.env));
