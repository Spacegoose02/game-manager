import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { json, now, type Db } from "../db/database.js";
import type { FetchLike } from "../metadata/http.js";
import type { ConnectorSettings } from "./settings.js";

export interface Finding {
  file: string;
  /** What flagged it: the ClamAV signature, or "VirusTotal: 12 engines". */
  threat: string;
  engine: "clamav" | "virustotal";
}

export interface ScanRecord {
  id: number;
  name: string;
  path: string;
  heldPath: string | null;
  status: "clean" | "flagged" | "error" | "released" | "deleted";
  findings: Finding[];
  scannedAt: string;
}

type ScanSettings = ConnectorSettings["scan"];

async function files(dir: string, out: string[] = []): Promise<string[]> {
  const s = await stat(dir);
  if (!s.isDirectory()) return [dir];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await files(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** One command to clamd over TCP (the z-prefixed, NUL-terminated form). */
function clamd(host: string, port: number, command: string, timeoutMs = 30 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let out = "";
    sock.setTimeout(timeoutMs, () => sock.destroy(new Error("ClamAV took too long")));
    sock.on("connect", () => sock.write(`z${command}\0`));
    sock.on("data", (d) => (out += d.toString()));
    sock.on("end", () => resolve(out.replace(/\0/g, "\n").trim()));
    sock.on("error", (err) => reject(new Error(`Can't reach ClamAV at ${host}:${port}: ${err.message}`)));
  });
}

/** Parses clamd/clamscan lines like "/path/file: Win.Trojan.Agent FOUND". */
export function parseClamOutput(out: string): Finding[] {
  return out
    .split("\n")
    .map((l) => l.match(/^(.*?): (.+) FOUND$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ file: m[1]!, threat: m[2]!, engine: "clamav" as const }));
}

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/**
 * Scans imports before they join the library: ClamAV (a clamd container or the clamscan
 * command) and, with a key, VirusTotal lookups of the main programs by hash (nothing is
 * uploaded). Anything flagged is moved to .held/ in the games folder until an admin decides.
 */
export class Scanner {
  constructor(
    private readonly db: Db,
    private readonly gamesDir: string,
    private readonly settings: () => ScanSettings,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get enabled(): boolean {
    const s = this.settings();
    return s.clamav !== "off" || !!s.virusTotalKey;
  }

  /** Scans a file or folder; returns what it found (empty when clean). Throws when a scanner fails. */
  async scan(target: string): Promise<Finding[]> {
    const s = this.settings();
    const found: Finding[] = [];
    if (s.clamav === "clamd") {
      // MULTISCAN reads the files itself, so mount the games folder into the ClamAV container at the same path.
      const out = await clamd(s.clamdHost, s.clamdPort, `MULTISCAN ${target}`);
      if (/No such file|lstat\(\) failed|ERROR$/m.test(out) && !/FOUND$/m.test(out)) {
        throw new Error(`ClamAV couldn't read ${target}; mount the games folder into the ClamAV container at the same path (${out.slice(0, 160)})`);
      }
      found.push(...parseClamOutput(out));
    } else if (s.clamav === "clamscan") {
      const out = await new Promise<string>((resolve, reject) => {
        const child = spawn("clamscan", ["-r", "--infected", "--no-summary", target], { stdio: ["ignore", "pipe", "pipe"] });
        let buf = "";
        child.stdout.on("data", (d) => (buf += d.toString()));
        child.on("error", () => reject(new Error("clamscan isn't installed in the container; use a ClamAV container (clamd) instead")));
        // 0 clean, 1 found, 2 error.
        child.on("close", (code) => (code === 2 ? reject(new Error("clamscan failed")) : resolve(buf)));
      });
      found.push(...parseClamOutput(out));
    }
    if (s.virusTotalKey) found.push(...(await this.virusTotal(target, s.virusTotalKey)));
    return found;
  }

  /** Checks each switched-on scanner answers: clamd's PING, clamscan's version, a VirusTotal lookup. */
  async test(): Promise<string> {
    const s = this.settings();
    const ok: string[] = [];
    if (s.clamav === "clamd") {
      const pong = await clamd(s.clamdHost, s.clamdPort, "PING", 10_000);
      if (!/PONG/.test(pong)) throw new Error(`ClamAV at ${s.clamdHost}:${s.clamdPort} answered "${pong.slice(0, 80)}"`);
      ok.push("ClamAV");
    } else if (s.clamav === "clamscan") {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("clamscan", ["--version"], { stdio: "ignore" });
        child.on("error", () => reject(new Error("clamscan isn't installed in the container; use a ClamAV container (clamd) instead")));
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("clamscan didn't start"))));
      });
      ok.push("clamscan");
    }
    if (s.virusTotalKey) {
      // The EICAR test file's hash: every engine knows it.
      const res = await this.fetchImpl("https://www.virustotal.com/api/v3/files/275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f", { headers: { "x-apikey": s.virusTotalKey }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 401 || res.status === 403) throw new Error("VirusTotal didn't accept the API key");
      if (!res.ok) throw new Error(`VirusTotal answered ${res.status}`);
      ok.push("VirusTotal");
    }
    if (!ok.length) throw new Error("Scanning is off; pick ClamAV or add a VirusTotal key first");
    return `${ok.join(" and ")} answered`;
  }

  /** Looks up the biggest programs by SHA-256 (the free API allows 4 lookups a minute). */
  private async virusTotal(target: string, key: string): Promise<Finding[]> {
    const programs = [];
    for (const f of await files(target)) if (/\.(exe|dll|msi|scr|com|bat|ps1)$/i.test(f)) programs.push({ f, size: (await stat(f)).size });
    const out: Finding[] = [];
    for (const { f } of programs.sort((a, b) => b.size - a.size).slice(0, 4)) {
      const res = await this.fetchImpl(`https://www.virustotal.com/api/v3/files/${await sha256(f)}`, { headers: { "x-apikey": key }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) continue; // VirusTotal hasn't seen this file
      if (res.status === 401) throw new Error("VirusTotal didn't accept the API key");
      if (!res.ok) continue;
      const stats = ((await res.json()) as { data?: { attributes?: { last_analysis_stats?: { malicious?: number } } } }).data?.attributes?.last_analysis_stats;
      // A couple of engines flag nearly every game launcher; three or more is worth a look.
      if ((stats?.malicious ?? 0) >= 3) out.push({ file: f, threat: `VirusTotal: ${stats!.malicious} engines flag it`, engine: "virustotal" });
    }
    return out;
  }

  /**
   * Scans a finished import. Clean (or scanning off): returns the path. Flagged with "hold" on:
   * moves it to .held/ and returns null. A broken scanner doesn't block imports; it's recorded.
   */
  async check(target: string, name: string): Promise<{ path: string | null; findings: Finding[]; error?: string }> {
    if (!this.enabled) return { path: target, findings: [] };
    const record = (status: ScanRecord["status"], findings: Finding[], held: string | null) =>
      this.db.prepare("INSERT INTO scans (name, path, held_path, status, findings, scanned_at) VALUES (?, ?, ?, ?, ?, ?)").run(name, target, held, status, JSON.stringify(findings), now());
    let findings: Finding[];
    try {
      findings = await this.scan(target);
    } catch (err) {
      record("error", [], null);
      return { path: target, findings: [], error: (err as Error).message };
    }
    if (!findings.length || !this.settings().hold) {
      record(findings.length ? "flagged" : "clean", findings, null);
      return { path: target, findings };
    }
    const heldDir = path.join(this.gamesDir, ".held");
    await mkdir(heldDir, { recursive: true });
    const held = path.join(heldDir, `${Date.now()}-${path.basename(target)}`);
    await rename(target, held);
    record("flagged", findings.map((f) => ({ ...f, file: f.file.replace(target, path.basename(target)) })), held);
    return { path: null, findings };
  }

  list(): ScanRecord[] {
    return (this.db.prepare("SELECT * FROM scans ORDER BY id DESC LIMIT 100").all() as Array<Record<string, unknown>>).map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      path: String(r.path),
      heldPath: (r.held_path as string | null) ?? null,
      status: r.status as ScanRecord["status"],
      findings: json<Finding[]>(r.findings, []),
      scannedAt: String(r.scanned_at),
    }));
  }

  /** An admin's call on a held import: put it in the library anyway, or delete it. */
  async decide(id: number, action: "release" | "delete"): Promise<void> {
    const r = this.list().find((x) => x.id === id);
    if (!r?.heldPath || r.status !== "flagged") throw new Error("Nothing held under that id");
    if (action === "release") {
      if (await stat(r.path).catch(() => null)) throw new Error(`${path.basename(r.path)} already exists in the games folder`);
      await rename(r.heldPath, r.path);
    } else {
      await rm(r.heldPath, { recursive: true, force: true });
    }
    this.db.prepare("UPDATE scans SET status = ?, held_path = NULL WHERE id = ?").run(action === "release" ? "released" : "deleted", id);
  }
}
