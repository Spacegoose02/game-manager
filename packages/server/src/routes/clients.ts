import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import { HttpProblem, requireAdmin, type AppContext } from "../context.js";

export function clientRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/clients", async () => ctx.clients.list());

  app.get<{ Params: { name: string } }>("/api/clients/:name", async (req, reply) => {
    let file: string;
    try {
      file = ctx.clients.path(req.params.name);
    } catch (err) {
      throw new HttpProblem(400, (err as Error).message);
    }
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) throw new HttpProblem(404, "No such file");
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Length", s.size);
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(req.params.name)}`);
    return reply.send(createReadStream(file));
  });

  // Upload: PUT the raw file body (application/octet-stream).
  app.put<{ Params: { name: string } }>("/api/clients/:name", async (req) => {
    requireAdmin(req);
    try {
      return await ctx.clients.save(req.params.name, req.body as Readable);
    } catch (err) {
      throw new HttpProblem(400, (err as Error).message);
    }
  });

  app.delete<{ Params: { name: string } }>("/api/clients/:name", async (req) => {
    requireAdmin(req);
    try {
      await ctx.clients.remove(req.params.name);
    } catch (err) {
      throw new HttpProblem(400, (err as Error).message);
    }
    return { ok: true };
  });

  app.post<{ Body: { repo?: string } }>("/api/clients/github", async (req) => {
    requireAdmin(req);
    try {
      return await ctx.clients.fetchRelease(String(req.body?.repo ?? "").trim());
    } catch (err) {
      throw new HttpProblem(400, (err as Error).message);
    }
  });
}
