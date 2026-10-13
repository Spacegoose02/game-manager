import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Readable } from "node:stream";
import { HttpProblem, requireAdmin, requirePerson, requireUser, type AppContext } from "../context.js";

/** Save sync: each player uploads and restores their own save backups per game. */
export function saveRoutes(app: FastifyInstance, ctx: AppContext) {
  const game = (req: FastifyRequest, id: string) => {
    const g = ctx.library.get(id);
    if (!g || (requireUser(req).kidMode && g.kidSafe !== true)) throw new HttpProblem(404, "Game not found");
    return g;
  };

  app.get("/api/saves", async (req) => ctx.saves.latestPerGame(requirePerson(req).id));

  app.get<{ Params: { id: string } }>("/api/games/:id/saves", async (req) => {
    game(req, req.params.id);
    return ctx.saves.list(requirePerson(req).id, req.params.id);
  });

  // Body: the zipped save folder (application/octet-stream). ?device= names the computer.
  app.post<{ Params: { id: string }; Querystring: { device?: string } }>("/api/games/:id/saves", async (req) => {
    const user = requirePerson(req);
    game(req, req.params.id);
    if (!req.body || typeof (req.body as Readable).pipe !== "function") throw new HttpProblem(400, "Send the zip as application/octet-stream");
    try {
      return await ctx.saves.add(user.id, req.params.id, req.body as Readable, req.query.device ?? null);
    } catch (err) {
      throw new HttpProblem(400, (err as Error).message);
    }
  });

  app.get<{ Params: { id: string; saveId: string } }>("/api/games/:id/saves/:saveId", async (req, reply) => {
    const found = ctx.saves.file(requirePerson(req).id, Number(req.params.saveId));
    if (!found || found.backup.gameId !== req.params.id) throw new HttpProblem(404, "Save not found");
    const s = await stat(found.path).catch(() => null);
    if (!s) throw new HttpProblem(404, "Save file is gone from the server");
    const title = game(req, req.params.id).title.replace(/[^\w .-]+/g, "");
    const name = `${title} save ${found.backup.createdAt.slice(0, 10)}.zip`;
    reply.header("Content-Type", "application/zip").header("Content-Length", s.size);
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(createReadStream(found.path));
  });

  app.delete<{ Params: { id: string; saveId: string } }>("/api/games/:id/saves/:saveId", async (req) => {
    if (!(await ctx.saves.remove(requirePerson(req).id, Number(req.params.saveId)))) throw new HttpProblem(404, "Save not found");
    return { ok: true };
  });

  // Where the game keeps its saves. Admins set it once for everyone.
  app.put<{ Params: { id: string }; Body: { path?: string | null } }>("/api/games/:id/save-path", async (req) => {
    requireAdmin(req);
    game(req, req.params.id);
    const p = req.body?.path?.trim() || null;
    if (p && !/^(\{game\}|%[A-Z]+%|~|\/|[A-Za-z]:)/.test(p)) {
      throw new HttpProblem(400, "Start the save path with %APPDATA%, %LOCALAPPDATA%, %USERPROFILE%, %DOCUMENTS%, {game} or a full path");
    }
    ctx.library.setSavePath(req.params.id, p);
    return ctx.library.get(req.params.id);
  });

  /** Save locations PCGamingWiki lists for this game. */
  app.get<{ Params: { id: string } }>("/api/games/:id/save-path/suggest", async (req) => {
    const g = game(req, req.params.id);
    try {
      return { paths: await ctx.metadata.pcgw.savePaths(g.metadata?.steamAppId ?? null, g.metadata?.name ?? g.title) };
    } catch (err) {
      throw new HttpProblem(502, `PCGamingWiki lookup failed: ${(err as Error).message}`);
    }
  });
}
