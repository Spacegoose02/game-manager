import type { FastifyInstance } from "fastify";
import { HttpProblem, requireAdmin, requireUser, type AppContext } from "../context.js";
import { planDownload } from "../sources/download.js";
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
  /**
   * Fetches a listed release with its own links: file-host links go to the Download Manager,
   * magnets and .torrent links to the torrent client. Only links the source listed are used.
   */
  app.post<{ Body: { id?: string; uri?: string | null; platform?: string | null } }>("/api/sources/download", async (req) => {
    const p = requireAdmin(req);
    const item = req.body?.id ? ctx.sources.item(req.body.id) : undefined;
    if (!item) throw new HttpProblem(404, "No such release");
    return fail(async () => {
      const torrents = (() => {
        try {
          return !!ctx.downloads.torrentClient();
        } catch {
          return false;
        }
      })();
      const plan = planDownload(item.downloads, { uri: req.body.uri, torrents });
      const platform = req.body.platform ?? item.platform;
      if (plan.via === "torrent") {
        const download = await ctx.downloads.grab({ url: plan.url, title: item.title, protocol: "torrent", platform }, p.user?.id ?? null);
        return { via: plan.via, message: `Sent ${item.title} to the torrent client`, download };
      }
      const pkg = ctx.direct.add({ links: plan.url, name: item.title, platform }, p.user?.id ?? null);
      return { via: plan.via, message: `Added ${item.title} to the Download Manager`, package: pkg };
    });
  });
  app.get<{ Querystring: { title?: string } }>("/api/sources/for", async (req) => {
    if (requireUser(req).kidMode || !req.query.title) return [];
    return ctx.sources.forTitle(req.query.title);
  });
}
