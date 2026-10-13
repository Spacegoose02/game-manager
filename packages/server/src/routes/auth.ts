import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthProviders } from "@game-manager/shared";
import { verifyPassword } from "../auth/crypto.js";
import { SESSION_COOKIE } from "../auth/service.js";
import { HttpProblem, type AppContext } from "../context.js";
import { publicUser, type UserRecord } from "../users/repo.js";

const FAIL_WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;

export function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const failures = new Map<string, { count: number; since: number }>();
  const secure = ctx.config.publicUrl.startsWith("https://");

  const startSession = (req: FastifyRequest, reply: FastifyReply, user: UserRecord) => {
    const { token, maxAgeSeconds } = ctx.auth.createSession(user.id, req.headers["user-agent"]);
    reply.setCookie(SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: maxAgeSeconds });
  };

  app.get("/api/auth/providers", async (): Promise<AuthProviders> => ({
    local: true,
    oidc: { enabled: ctx.oidc.enabled, name: ctx.config.oidc.name },
    header: !!ctx.config.headerAuth.userHeader,
    setupRequired: ctx.users.count() === 0,
  }));

  /** Creates the first admin. Only works while there are no accounts. */
  app.post<{ Body: { username: string; password: string; displayName?: string } }>("/api/auth/setup", async (req, reply) => {
    if (ctx.users.count() > 0) throw new HttpProblem(409, "Setup is already done");
    const { username, password, displayName } = req.body ?? ({} as never);
    if (!password) throw new HttpProblem(400, "A password is required");
    const user = await ctx.users.create({ username, password, displayName, role: "admin" });
    startSession(req, reply, user);
    return publicUser(user);
  });

  /**
   * Password login. Browsers get a session cookie; clients pass {client: true, device}
   * and get a personal API token back instead.
   */
  app.post<{ Body: { username: string; password: string; client?: boolean; device?: string } }>("/api/auth/login", async (req, reply) => {
    const { username = "", password = "", client, device } = req.body ?? ({} as never);
    const key = `${req.ip}|${username.toLowerCase()}`;
    const f = failures.get(key);
    if (f && Date.now() - f.since < FAIL_WINDOW_MS && f.count >= MAX_FAILS) {
      throw new HttpProblem(429, "Too many failed attempts; wait 15 minutes");
    }
    const user = ctx.users.byUsername(username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      const entry = f && Date.now() - f.since < FAIL_WINDOW_MS ? f : { count: 0, since: Date.now() };
      entry.count++;
      failures.set(key, entry);
      throw new HttpProblem(401, "Wrong username or password");
    }
    failures.delete(key);
    if (client) {
      const { token } = ctx.auth.createApiToken(user.id, device || "Game Manager client");
      return { token, user: publicUser(user) };
    }
    startSession(req, reply, user);
    return { user: publicUser(user) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) ctx.auth.endSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get<{ Querystring: { returnTo?: string } }>("/api/auth/oidc/login", async (req, reply) => {
    if (!ctx.oidc.enabled) throw new HttpProblem(404, "Single sign-on is not configured");
    return reply.redirect(await ctx.oidc.start(req.query.returnTo));
  });

  app.get("/api/auth/oidc/callback", async (req, reply) => {
    if (!ctx.oidc.enabled) throw new HttpProblem(404, "Single sign-on is not configured");
    try {
      const { user, returnTo } = await ctx.oidc.finish(new URL(req.url, ctx.config.publicUrl));
      startSession(req, reply, user);
      return reply.redirect(returnTo);
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, "OIDC login failed");
      return reply.redirect(`/login?error=${encodeURIComponent((err as Error).message)}`);
    }
  });
}
