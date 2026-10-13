#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { GameServerClient } from "./api.js";
import { configPath, loadConfig, saveConfigValue } from "./config.js";
import { listDrives } from "./drives.js";
import { listInstalled, uninstallGame } from "./installed.js";
import { installGame, pickGame, type InstallEvent } from "./installer.js";
import { findExecutable, launchAndTrack, saveExecutable } from "./launcher.js";

const HELP = `Game Manager client

Usage:
  gm login <username> [--server URL] Sign in and save a token for this computer
  gm whoami                          Show who you are signed in as
  gm list [search]                   List games on the server
  gm info <game>                     Show a game's files
  gm install <game> [options]        Download, unpack and remove archives
      --dest <folder>                Install under this folder (any drive), instead of installDir
      --keep-archives                Keep zip/7z/rar files after unpacking
  gm installed                       Games installed on this computer
  gm play <game>                     Launch an installed game and record play time
  gm uninstall <game>                Delete an installed game from this computer
  gm drives                          Drives you can install to, with free space
  gm stats                           Library size and server disk space
  gm rescan                          Ask the server to rescan its games folder
  gm config show | path              Show settings or where they are stored
  gm config set <key> <value>        Keys: serverUrl, apiToken, installDir, sevenZipPath, keepArchives

<game> is an id, a title, or part of a title.
Environment overrides: GM_SERVER, GM_TOKEN, GM_INSTALL_DIR, GM_7Z, GM_CONFIG.`;

function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--") && a !== "--keep-archives") {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function progressPrinter(): (e: InstallEvent) => void {
  let lastLine = 0;
  return (e) => {
    switch (e.type) {
      case "start":
        console.log(`Installing ${e.game.title} (${formatBytes(e.game.sizeBytes)}) to ${e.gameDir}`);
        break;
      case "download": {
        const now = Date.now();
        if (now - lastLine < 500 && e.received < e.total) return;
        lastLine = now;
        const pct = e.total ? ((e.received / e.total) * 100).toFixed(1) : "100";
        const line = `[${e.index + 1}/${e.count}] ${e.file}  ${pct}%  ${formatBytes(e.received)} / ${formatBytes(e.total)}`;
        if (process.stdout.isTTY) process.stdout.write(`\r${line.padEnd(100)}`);
        break;
      }
      case "downloaded":
        if (process.stdout.isTTY) process.stdout.write("\n");
        if (e.skipped) console.log(`Already downloaded: ${e.file}`);
        break;
      case "extract":
        console.log(`Unpacking ${e.archive}`);
        break;
      case "removed":
        console.log(`Removed ${e.files.length} archive file(s)`);
        break;
      case "warning":
        console.warn(`Warning: ${e.message}`);
        break;
      case "done":
        console.log(`Done: ${e.gameDir}`);
        break;
    }
  };
}

/** Reads a line from the terminal without echoing it. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(prompt)) write.call(rl, prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { positional, flags } = parseFlags(rest);
  const config = await loadConfig();
  const api = new GameServerClient(config);

  switch (command) {
    case "login": {
      const username = positional[0];
      if (!username) throw new Error("Usage: gm login <username> [--server http://tower:8080]");
      if (typeof flags.server === "string") {
        config.serverUrl = flags.server;
        await saveConfigValue("serverUrl", flags.server);
      }
      const password = typeof flags.password === "string" ? flags.password : await askHidden("Password: ");
      const { token, user } = await new GameServerClient(config).login(username, password, os.hostname());
      await saveConfigValue("apiToken", token);
      console.log(`Signed in as ${user.displayName} (${user.role}). Token saved to ${configPath()}`);
      return;
    }
    case "whoami": {
      const me = await api.me();
      console.log(me.user ? `${me.user.displayName} (${me.user.username}, ${me.role}${me.user.kidMode ? ", kid profile" : ""})` : `Service token (${me.role})`);
      return;
    }
    case "list": {
      const games = await api.listGames(positional.join(" ") || undefined);
      for (const g of games) console.log(`${g.id}  ${formatBytes(g.sizeBytes).padStart(9)}  ${g.packed ? "packed" : "      "}  ${g.title}`);
      console.log(`${games.length} game(s)`);
      return;
    }
    case "info": {
      const summary = pickGame(await api.listGames(), positional.join(" "));
      const game = await api.getGame(summary.id);
      console.log(`${game.title}  [${game.id}]  ${formatBytes(game.sizeBytes)}, ${game.fileCount} file(s)`);
      for (const f of game.files) console.log(`  ${formatBytes(f.size).padStart(9)}  ${f.archive ? `[${f.archive}] ` : ""}${f.path}`);
      return;
    }
    case "install": {
      if (positional.length === 0) throw new Error("Which game? Usage: gm install <game>");
      const summary = pickGame(await api.listGames(), positional.join(" "));
      await installGame(api, summary.id, {
        installDir: path.resolve(typeof flags.dest === "string" ? flags.dest : config.installDir),
        keepArchives: flags["keep-archives"] === true || config.keepArchives,
        sevenZipPath: config.sevenZipPath,
        onEvent: progressPrinter(),
      });
      return;
    }
    case "drives": {
      for (const d of await listDrives()) console.log(`${d.label.padEnd(16)} ${formatBytes(d.freeBytes).padStart(9)} free of ${formatBytes(d.totalBytes)}`);
      return;
    }
    case "installed": {
      const games = await listInstalled([config.installDir]);
      for (const g of games) console.log(`${g.gameId}  ${g.title}  ${g.dir}`);
      console.log(`${games.length} installed under ${config.installDir}`);
      return;
    }
    case "play": {
      const installed = await listInstalled([config.installDir, ...(typeof flags.dir === "string" ? [flags.dir] : [])]);
      const q = positional.join(" ").toLowerCase();
      const game = installed.find((g) => g.gameId === q || g.title.toLowerCase() === q) ?? installed.find((g) => g.title.toLowerCase().includes(q));
      if (!game) throw new Error(`"${positional.join(" ")}" is not installed under ${config.installDir}`);
      const exe = typeof flags.exe === "string" ? flags.exe : game.executable ?? (await findExecutable(game.dir, game.title));
      if (!exe) throw new Error(`No executable found in ${game.dir}; pass --exe <relative path>`);
      if (exe !== game.executable) await saveExecutable(game.dir, exe);
      console.log(`Starting ${game.title} (${exe})`);
      const seconds = await launchAndTrack(game.dir, exe);
      await api.reportActivity({ gameId: game.gameId, device: os.hostname(), event: "played", seconds });
      console.log(`Played for ${Math.round(seconds / 60)} min`);
      return;
    }
    case "uninstall": {
      const installed = await listInstalled([config.installDir]);
      const q = positional.join(" ").toLowerCase();
      const game = installed.find((g) => g.gameId === q || g.title.toLowerCase() === q);
      if (!game) throw new Error(`"${positional.join(" ")}" is not installed under ${config.installDir} (use the exact title or id)`);
      await uninstallGame(game.dir);
      await api.reportActivity({ gameId: game.gameId, device: os.hostname(), event: "uninstalled" });
      console.log(`Removed ${game.dir}`);
      return;
    }
    case "stats": {
      const s = await api.stats();
      console.log(`${s.gameCount} games, ${formatBytes(s.totalBytes)}`);
      if (s.disk) console.log(`Server disk: ${formatBytes(s.disk.freeBytes)} free of ${formatBytes(s.disk.totalBytes)}`);
      if (s.lastScanAt) console.log(`Last scan: ${s.lastScanAt} (${s.lastScanMs} ms)`);
      return;
    }
    case "rescan": {
      const s = await api.rescan();
      console.log(`Rescanned: ${s.gameCount} games`);
      return;
    }
    case "config": {
      if (positional[0] === "set" && positional.length === 3) {
        await saveConfigValue(positional[1]!, positional[2]!);
        console.log(`Saved ${positional[1]} to ${configPath()}`);
      } else if (positional[0] === "path") {
        console.log(configPath());
      } else {
        console.log(JSON.stringify({ ...config, apiToken: config.apiToken ? "********" : "" }, null, 2));
      }
      return;
    }
    default:
      console.log(HELP);
  }
}

main(process.argv.slice(2)).catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
