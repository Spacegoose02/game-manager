import type { ServerConfig } from "../config.js";
import { json, type Db } from "../db/database.js";

/**
 * API keys and single sign-on settings an admin can change in the web UI. A value
 * set here wins over the matching environment variable; an empty one falls back to it.
 */
export interface IntegrationSettings {
  publicUrl: string;
  igdb: { clientId: string; clientSecret: string };
  rawg: { apiKey: string };
  steamgriddb: { apiKey: string };
  oidc: { issuer: string; clientId: string; clientSecret: string; name: string; adminGroup: string; autoCreate: boolean };
}

/** What the UI gets: stored values with secrets masked, plus which fields the environment already sets. */
export interface IntegrationsView {
  settings: IntegrationSettings;
  fromEnvironment: string[];
  callbackUrl: string | null;
}

const KEY = "integrations";
export const SECRET = "********";
const SECRETS = ["igdb.clientSecret", "rawg.apiKey", "steamgriddb.apiKey", "oidc.clientSecret"] as const;

const EMPTY: IntegrationSettings = {
  publicUrl: "",
  igdb: { clientId: "", clientSecret: "" },
  rawg: { apiKey: "" },
  steamgriddb: { apiKey: "" },
  oidc: { issuer: "", clientId: "", clientSecret: "", name: "", adminGroup: "", autoCreate: true },
};

type Path = (typeof SECRETS)[number];
const getAt = (s: IntegrationSettings, p: string): unknown => p.split(".").reduce<any>((o, k) => o?.[k], s);
function setAt(s: IntegrationSettings, p: Path, v: string) {
  const [a, b] = p.split(".") as [keyof IntegrationSettings, string];
  (s[a] as Record<string, unknown>)[b] = v;
}

export class Integrations {
  /** The config as the environment set it, so clearing a UI value restores it. */
  private readonly env: { publicUrl: string; igdb: ServerConfig["igdb"]; oidc: ServerConfig["oidc"]; rawg: string; steamgriddb: string };

  constructor(
    private readonly db: Db,
    private readonly config: ServerConfig,
  ) {
    this.env = {
      publicUrl: config.publicUrl,
      igdb: { ...config.igdb },
      oidc: { ...config.oidc },
      rawg: config.rawg.apiKey,
      steamgriddb: config.steamgriddb.apiKey,
    };
    this.apply();
  }

  stored(): IntegrationSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
    const s = json<Partial<IntegrationSettings>>(row?.value, {});
    return {
      publicUrl: s.publicUrl ?? "",
      igdb: { ...EMPTY.igdb, ...s.igdb },
      rawg: { ...EMPTY.rawg, ...s.rawg },
      steamgriddb: { ...EMPTY.steamgriddb, ...s.steamgriddb },
      oidc: { ...EMPTY.oidc, ...s.oidc },
    };
  }

  view(): IntegrationsView {
    const s = structuredClone(this.stored());
    for (const p of SECRETS) if (getAt(s, p)) setAt(s, p, SECRET);
    const fromEnvironment: string[] = [];
    if (this.env.publicUrl) fromEnvironment.push("publicUrl");
    if (this.env.igdb.clientId) fromEnvironment.push("igdb");
    if (this.env.rawg) fromEnvironment.push("rawg");
    if (this.env.steamgriddb) fromEnvironment.push("steamgriddb");
    if (this.env.oidc.issuer) fromEnvironment.push("oidc");
    return { settings: s, fromEnvironment, callbackUrl: this.config.publicUrl ? `${this.config.publicUrl}/api/auth/oidc/callback` : null };
  }

  /** Saves what the admin sent; a masked secret keeps its stored value. Returns the new view. */
  save(incoming: Partial<IntegrationSettings>): IntegrationsView {
    const current = this.stored();
    const next: IntegrationSettings = {
      publicUrl: (incoming.publicUrl ?? current.publicUrl).trim().replace(/\/+$/, ""),
      igdb: { ...current.igdb, ...incoming.igdb },
      rawg: { ...current.rawg, ...incoming.rawg },
      steamgriddb: { ...current.steamgriddb, ...incoming.steamgriddb },
      oidc: { ...current.oidc, ...incoming.oidc },
    };
    for (const p of SECRETS) if (getAt(next, p) === SECRET) setAt(next, p, getAt(current, p) as string);
    next.oidc.issuer = next.oidc.issuer.trim().replace(/\/+$/, "");
    if (next.publicUrl && !/^https?:\/\/[^/]+/.test(next.publicUrl)) throw new Error("The public address must start with http:// or https://");
    if (next.oidc.issuer && !/^https?:\/\/[^/]+/.test(next.oidc.issuer)) throw new Error("The OIDC issuer must start with http:// or https://");
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(KEY, JSON.stringify(next));
    this.apply();
    return this.view();
  }

  /** Writes the effective values (UI first, then environment) into the live config. */
  private apply(): void {
    const s = this.stored();
    const pick = (ui: string, env: string) => ui.trim() || env;
    this.config.publicUrl = pick(s.publicUrl, this.env.publicUrl);
    const igdbFromUi = !!(s.igdb.clientId && s.igdb.clientSecret);
    this.config.igdb = igdbFromUi ? { ...s.igdb } : { ...this.env.igdb };
    this.config.rawg = { apiKey: pick(s.rawg.apiKey, this.env.rawg) };
    this.config.steamgriddb = { apiKey: pick(s.steamgriddb.apiKey, this.env.steamgriddb) };
    if (s.oidc.issuer && s.oidc.clientId) {
      this.config.oidc = {
        ...this.env.oidc,
        issuer: s.oidc.issuer,
        clientId: s.oidc.clientId,
        clientSecret: s.oidc.clientSecret,
        name: s.oidc.name || this.env.oidc.name,
        adminGroup: s.oidc.adminGroup,
        autoCreate: s.oidc.autoCreate,
      };
    } else {
      this.config.oidc = { ...this.env.oidc };
    }
  }
}
