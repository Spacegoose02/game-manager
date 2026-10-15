import type { FastifyInstance } from "fastify";
import { HOSTS } from "../direct/hosts.js";
import { HttpProblem, requireAdmin, type AppContext } from "../context.js";

/** Admin-only Download Manager: paste file-host links, LootDen finds the files and downloads them. */
export function directRoutes(app: FastifyInstance, ctx: AppContext) {
  const wrap = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpProblem) throw err;
      throw new HttpProblem(400, (err as Error).message);
    }
  };

  app.get("/api/direct", async (req) => {
    requireAdmin(req);
    return { hosts: HOSTS.map((h) => h.name), packages: ctx.direct.list() };
  });

  app.post<{ Body: { links?: string } }>("/api/direct/check", async (req) => {
    requireAdmin(req);
    return wrap(() => ctx.direct.check(req.body?.links ?? ""));
  });

  app.post<{ Body: { links?: string; name?: string | null; platform?: string | null } }>("/api/direct", async (req) => {
    const p = requireAdmin(req);
    return wrap(() => ctx.direct.add({ links: req.body?.links ?? "", name: req.body?.name, platform: req.body?.platform }, p.user?.id ?? null));
  });

  app.post<{ Params: { id: string }; Body: { action?: string } }>("/api/direct/:id", async (req) => {
    requireAdmin(req);
    const action = req.body?.action;
    if (action !== "pause" && action !== "resume" && action !== "retry" && action !== "remove") throw new HttpProblem(400, "action is pause, resume, retry or remove");
    return wrap(async () => {
      await ctx.direct.control(Number(req.params.id), action);
      return { ok: true };
    });
  });
}
