import type { FastifyInstance } from "fastify";
import { HttpProblem, requireAdmin, type AppContext } from "../context.js";

export function newsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/news", async () => ctx.news.items());
  app.get("/api/news/feeds", async () => ctx.news.feeds());
  app.post<{ Body: { url: string; title?: string } }>("/api/news/feeds", async (req) => {
    requireAdmin(req);
    try {
      return await ctx.news.add(req.body?.url ?? "", req.body?.title);
    } catch (err) {
      throw new HttpProblem(400, `Could not add feed: ${(err as Error).message}`);
    }
  });
  app.delete<{ Params: { id: string } }>("/api/news/feeds/:id", async (req) => {
    requireAdmin(req);
    ctx.news.remove(req.params.id);
    return { ok: true };
  });
}
