import type { FastifyInstance, FastifyRequest } from "fastify";
import type { GameListing } from "@lootden/shared";
import { HttpProblem, requireAdmin, requireUser, type AppContext } from "../context.js";

/** Release calendar, Discover and YouTube rows. Kid profiles don't get these: nothing here is age-rated. */
export function discoverRoutes(app: FastifyInstance, ctx: AppContext) {
  const grownUp = (req: FastifyRequest) => {
    if (requireUser(req).kidMode) throw new HttpProblem(403, "Not available on kid profiles");
  };
  const upstream = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      throw new HttpProblem(502, (err as Error).message);
    }
  };

  app.get<{ Querystring: { days?: string; platform?: string } }>("/api/calendar", async (req) => {
    grownUp(req);
    const days = Math.min(Math.max(Number(req.query.days) || 120, 7), 365);
    return upstream(() => ctx.calendar.upcoming(days, req.query.platform === "all" ? "all" : "pc"));
  });

  app.get("/api/discover", async (req) => {
    grownUp(req);
    const [trending, upcoming] = await Promise.all([
      upstream(() => ctx.calendar.trending()),
      upstream(() => ctx.calendar.upcoming()),
    ]);
    return { trending, upcoming: { ...upcoming, items: upcoming.items.slice(0, 30) } };
  });

  /** Any game the metadata services know, not just the library. */
  app.get<{ Querystring: { q?: string } }>("/api/discover/search", async (req) => {
    grownUp(req);
    const q = req.query.q?.trim();
    if (!q) return [];
    const candidates = await upstream(() => ctx.metadata.search(q));
    const listings: GameListing[] = candidates.map((c) => ({
      provider: c.provider,
      providerId: c.providerId,
      name: c.name,
      releaseDate: null,
      dateText: c.year ? String(c.year) : null,
      coverUrl: c.coverUrl,
      imageUrl: null,
      platforms: [],
      genres: [],
      url: c.provider === "steam" ? `https://store.steampowered.com/app/${c.providerId}/` : null,
      libraryId: null,
    }));
    return ctx.calendar.markLibrary(listings);
  });

  app.get("/api/videos", async (req) => {
    grownUp(req);
    return ctx.videos.rows();
  });

  app.get("/api/videos/groups", async () => ctx.videos.groups());

  app.put<{ Body: { groups?: Array<{ id?: string; title: string; intervalMinutes?: number; channels: string[] }> } }>("/api/videos/groups", async (req) => {
    requireAdmin(req);
    try {
      return await ctx.videos.save(req.body?.groups ?? []);
    } catch (err) {
      throw new HttpProblem(400, (err as Error).message);
    }
  });
}
