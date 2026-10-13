import * as client from "openid-client";
import type { ServerConfig } from "../config.js";
import type { UserRecord, UserRepo } from "../users/repo.js";

interface Pending {
  verifier: string;
  returnTo: string;
  expires: number;
}

/**
 * Authorization-code login with PKCE against any OpenID Connect provider
 * (TinyAuth, Authelia, Authentik, Keycloak, Pocket ID, Google ...).
 */
export class OidcService {
  private configPromise: Promise<client.Configuration> | null = null;
  private pending = new Map<string, Pending>();

  constructor(
    private readonly config: ServerConfig,
    private readonly users: UserRepo,
  ) {}

  /** Forgets the discovered provider, after its settings change. */
  reset(): void {
    this.configPromise = null;
    this.pending.clear();
  }

  /** Fetches the provider's discovery document, for the Test button. */
  async test(): Promise<string> {
    this.reset();
    const cfg = await this.discover();
    return `Found ${cfg.serverMetadata().issuer}`;
  }

  get enabled(): boolean {
    const o = this.config.oidc;
    return !!(o.issuer && o.clientId && this.config.publicUrl);
  }

  get redirectUri(): string {
    return `${this.config.publicUrl}/api/auth/oidc/callback`;
  }

  private discover(): Promise<client.Configuration> {
    const o = this.config.oidc;
    this.configPromise ??= client
      .discovery(new URL(o.issuer), o.clientId, o.clientSecret || undefined, o.clientSecret ? undefined : client.None(), {
        execute: new URL(o.issuer).protocol === "http:" ? [client.allowInsecureRequests] : [],
      })
      .catch((err) => {
        this.configPromise = null; // retry discovery next time
        throw err;
      });
    return this.configPromise;
  }

  async start(returnTo = "/"): Promise<string> {
    const cfg = await this.discover();
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k);
    this.pending.set(state, { verifier, returnTo: returnTo.startsWith("/") ? returnTo : "/", expires: now + 10 * 60_000 });
    return client
      .buildAuthorizationUrl(cfg, {
        redirect_uri: this.redirectUri,
        scope: this.config.oidc.scopes,
        state,
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      })
      .toString();
  }

  /** Finishes the login and returns the local account (created on first login when allowed). */
  async finish(callbackUrl: URL): Promise<{ user: UserRecord; returnTo: string }> {
    const cfg = await this.discover();
    const state = callbackUrl.searchParams.get("state") ?? "";
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.expires < Date.now()) throw new Error("Login expired or was started elsewhere; try again");
    const tokens = await client.authorizationCodeGrant(cfg, callbackUrl, { pkceCodeVerifier: pending.verifier, expectedState: state });
    let claims: Record<string, unknown> = { ...(tokens.claims() ?? {}) };
    if (tokens.access_token && claims.sub) {
      try {
        claims = { ...claims, ...(await client.fetchUserInfo(cfg, tokens.access_token, claims.sub as string)) };
      } catch {
        // Some providers have no userinfo endpoint; the ID token claims are enough.
      }
    }
    return { user: await this.provision(claims), returnTo: pending.returnTo };
  }

  private async provision(claims: Record<string, unknown>): Promise<UserRecord> {
    const sub = String(claims.sub ?? "");
    if (!sub) throw new Error("The identity provider returned no subject");
    const email = typeof claims.email === "string" ? claims.email : null;
    const preferred = String(claims.preferred_username ?? claims.nickname ?? email?.split("@")[0] ?? sub);
    const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : [];
    const isAdmin = !!this.config.oidc.adminGroup && groups.includes(this.config.oidc.adminGroup);

    let user = this.users.byOidcSubject(sub);
    if (!user) {
      // Link to an existing local account with the same email or username.
      const existing = (email && this.users.byEmail(email)) || this.users.byUsername(preferred);
      if (existing) user = await this.users.update(existing.id, { oidcSubject: sub });
    }
    if (!user) {
      if (!this.config.oidc.autoCreate) throw new Error("No account for this login; ask an admin to create one");
      user = await this.users.create({
        username: preferred.replace(/[^\w.@-]/g, "_"),
        displayName: String(claims.name ?? preferred),
        email,
        role: isAdmin || this.users.count() === 0 ? "admin" : "user",
        oidcSubject: sub,
      });
    } else if (isAdmin && user.role !== "admin") {
      user = await this.users.update(user.id, { role: "admin" });
    }
    return user;
  }
}
