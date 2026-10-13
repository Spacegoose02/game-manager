import type { FastifyInstance } from "fastify";
import { HttpProblem, requireAdmin, requireUser, type AppContext } from "../context.js";
import type { SourceConfig } from "../sources/types.js";

/** Settings, Sources, plus the releases they list for Discover. */
export function sourceRoutes(app: FastifyInstance, ctx: AppContext) {
  const fail = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw new HttpProblem(400, (err as Error).message);
    }
  };

  app.get("/api/sources", async (req) => {
    requireAdmin(req);
    return ctx.sources.list();
  });
  app.put<{ Params: { id: string }; Body: Partial<SourceConfig> }>("/api/sources/:id", async (req) => {
    requireAdmin(req);
    return fail(() => ctx.sources.save(req.params.id, req.body ?? {}));
  });
  /** Fetches the source once now. */
  app.post<{ Params: { id: string } }>("/api/sources/:id/test", async (req) => {
    requireAdmin(req);
    const count = await fail(() => ctx.sources.refresh(req.params.id));
    return { message: `Listed ${count} releases`, sources: ctx.sources.list() };
  });

  app.get<{ Querystring: { limit?: string } }>("/api/sources/latest", async (req) => {
    if (requireUser(req).kidMode) return [];
    return ctx.sources.latest(Math.min(100, Number(req.query.limit) || 40));
  });
  app.get<{ Querystring: { title?: string } }>("/api/sources/for", async (req) => {
    if (requireUser(req).kidMode || !req.query.title) return [];
    return ctx.sources.forTitle(req.query.title);
  });
}
