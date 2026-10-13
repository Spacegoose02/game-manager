// Programmatic entry point (used by tests and future embedders). index.ts is the runnable server.
export { buildApp, VERSION } from "./app.js";
export { loadConfig, type ServerConfig } from "./config.js";
export { openDatabase } from "./db/database.js";
export type { AppContext } from "./context.js";
