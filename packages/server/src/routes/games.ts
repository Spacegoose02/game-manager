import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { safeFolderName, type ControllerSupport, type GameSummary } from "@lootden/shared";
import type { GameQuery } from "../catalog/library.js";
import { resolveGameFile } from "../catalog/scanner.js";
import { HttpProblem, requireAdmin, requireUser, type AppContext } from "../context.js";

/** Parses a single "bytes=start-end" range. Returns null for absent/unsupported headers, "invalid" when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null; // multi-range or other units: fall back to the full file
  const [, s, e] = m;
  let start: number;
  let end: number;
  if (s === "") {
    if (e === "") return "invalid";
    const suffix = Number(e);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === "" ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

type ListQuery = {
  search?: string;
  genre?: string;
  controller?: GameQuery["controller"];
  kidSafe?: string;
  missingMetadata?: string;
  sort?: GameQuery["sort"];
  order?: GameQuery["order"];
  limit?: string;
};

export function gameRoutes(app: FastifyInstance, ctx: AppContext) {
  const kidOnly = (req: FastifyRequest) => requireUser(req).kidMode;

  /** Kid profiles cannot see or download games that are not known to be kid-safe. */
  const visibleGame = (req: FastifyRequest, id: string) => {
    const game = ctx.library.get(id);
    if (!game || (kidOnly(req) && game.kidSafe !== true)) throw new HttpProblem(404, "Game not found");
    return game;
  };

  app.get<{ Querystring: ListQuery }>("/api/games", async (req) => {
    const q = req.query;
    return ctx.library.list({
      search: q.search,
      genre: q.genre,
      controller: q.controller,
      kidSafe: kidOnly(req) || q.kidSafe === "true" || q.kidSafe === "1",
      missingMetadata: q.missingMetadata === "true",
      sort: q.sort,
      order: q.order,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });

  app.get("/api/genres", async (req) => ctx.library.genres(kidOnly(req)));

  /** Rows for the featured home page. */
  app.get("/api/home", async (req) => {
    const p = requireUser(req);
    const kidSafe = p.kidMode;
    const all = ctx.library.list({ kidSafe });
    const sections: Array<{ id: string; title: string; games: GameSummary[] }> = [];
    const add = (id: string, title: string, games: GameSummary[]) => games.length && sections.push({ id, title, games: games.slice(0, 20) });

    if (p.user) {
      const states = ctx.users.gameStates(p.user.id).filter((s) => s.lastPlayedAt);
      const byId = new Map(all.map((g) => [g.id, g]));
      add("continue", "Continue playing", [...new Set(states.map((s) => s.gameId))].map((id) => byId.get(id)!).filter(Boolean));
    }
    add("recent", "Recently added", ctx.library.list({ kidSafe, sort: "added", order: "desc", limit: 20 }));
    add("top", "Top rated", all.filter((g) => g.rating != null).sort((a, b) => b.rating! - a.rating!));
    add("controller", "Great with a controller", all.filter((g) => g.controllerSupport === "full"));
    if (!kidSafe) add("kids", "Family friendly", all.filter((g) => g.kidSafe === true));
    for (const { name } of ctx.library.genres(kidSafe).slice(0, 6)) add(`genre:${name}`, name, all.filter((g) => g.genres.includes(name)));
    const featured = all
      .filter((g) => g.coverUrl)
      .sort(() => Math.random() - 0.5)
      .slice(0, 6)
      .map((g) => {
        const d = ctx.library.get(g.id);
        return { ...g, backgroundUrl: d?.backgroundUrl ?? null, blurb: d?.metadata?.summary?.slice(0, 280) ?? null };
      });
    return { featured, sections };
  });

  app.get<{ Params: { id: string } }>("/api/games/:id", async (req) => visibleGame(req, req.params.id));

  for (const kind of ["cover", "background"] as const) {
    app.get<{ Params: { id: string } }>(`/api/games/:id/${kind}`, async (req, reply) => {
      visibleGame(req, req.params.id);
      const image = await ctx.metadata.imageFile(req.params.id, kind);
      if (!image) throw new HttpProblem(404, `No ${kind}`);
      // URLs carry ?v=<hash of the source>, so a long cache is safe.
      reply.header("Content-Type", image.contentType).header("Cache-Control", "private, max-age=604800");
      return reply.send(createReadStream(image.file));
    });
  }

  // ---- Admin: custom artwork --------------------------------------------------

  app.get<{ Params: { id: string; kind: string }; Querystring: { q?: string } }>("/api/games/:id/artwork/:kind", async (req) => {
    requireAdmin(req);
    const kind = artworkKind(req.params.kind);
    visibleGame(req, req.params.id);
    try {
      return await ctx.metadata.artworkOptions(req.params.id, kind, req.query.q?.trim() || undefined);
    } catch (err) {
      throw new HttpProblem(502, (err as Error).message);
    }
  });

  // Body: an image (Content-Type image/*) to upload, or JSON { url } to use an image from the web.
  app.put<{ Params: { id: string; kind: string } }>("/api/games/:id/artwork/:kind", async (req) => {
    requireAdmin(req);
    const kind = artworkKind(req.params.kind);
    visibleGame(req, req.params.id);
    try {
      if (Buffer.isBuffer(req.body)) await ctx.metadata.saveUpload(req.params.id, kind, req.body, String(req.headers["content-type"]).split(";")[0]!);
      else ctx.metadata.setOverride(req.params.id, kind, String((req.body as { url?: string })?.url ?? "").trim());
    } catch (err) {
      throw new HttpProblem(400, (err as Error).message);
    }
    return ctx.library.get(req.params.id);
  });

  app.delete<{ Params: { id: string; kind: string } }>("/api/games/:id/artwork/:kind", async (req) => {
    requireAdmin(req);
    ctx.metadata.setOverride(req.params.id, artworkKind(req.params.kind), null);
    return ctx.library.get(req.params.id);
  });

  /**
   * Admin: replace a disc-image or installer game with the zipped, installed game
   * (application/octet-stream). The original moves to .replaced/ in the games folder.
   */
  app.put<{ Params: { id: string }; Querystring: { version?: string } }>("/api/games/:id/prepared", async (req) => {
    requireAdmin(req);
    const game = visibleGame(req, req.params.id);
    if (!req.body || typeof (req.body as Readable).pipe !== "function") throw new HttpProblem(400, "Send the zip as application/octet-stream");
    const version = req.query.version?.trim().replace(/^v/i, "");
    const name = `${safeFolderName(version ? `${game.title} v${version}` : game.title)}.zip`;
    const target = path.join(ctx.config.gamesDir, name);
    if (await stat(target).catch(() => null)) throw new HttpProblem(409, `${name} is already in the games folder`);
    const temp = path.join(ctx.config.gamesDir, `.${name}.uploading`);
    try {
      await pipeline(req.body as Readable, createWriteStream(temp));
      if ((await stat(temp)).size === 0) throw new Error("The upload was empty");
      await rename(temp, target);
    } catch (err) {
      await rm(temp, { force: true });
      throw new HttpProblem(400, (err as Error).message);
    }
    return ctx.library.replaceGame(game.id, name);
  });

  app.get<{ Params: { id: string; index: string } }>("/api/games/:id/files/:index", async (req, reply) => {
    const game = visibleGame(req, req.params.id);
    const file = game.files[Number(req.params.index)];
    if (!file) throw new HttpProblem(404, "File not found");

    const fullPath = resolveGameFile(ctx.config.gamesDir, game, file);
    let size: number;
    try {
      size = (await stat(fullPath)).size;
    } catch {
      throw new HttpProblem(404, "File is gone from disk; rescan the library");
    }

    const fileName = file.path.split("/").pop()!;
    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);

    const range = parseRange(req.headers.range, size);
    if (range === "invalid") {
      reply.header("Content-Range", `bytes */${size}`);
      return reply.code(416).send();
    }
    if (range) {
      reply.code(206);
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      reply.header("Content-Length", range.end - range.start + 1);
      return reply.send(createReadStream(fullPath, { start: range.start, end: range.end }));
    }
    reply.header("Content-Length", size);
    return reply.send(createReadStream(fullPath));
  });

  // ---- Admin: overrides and metadata matching ---------------------------------

  app.patch<{ Params: { id: string }; Body: { title?: string | null; kidSafe?: boolean | null; controllerSupport?: ControllerSupport | null } }>(
    "/api/games/:id",
    async (req) => {
      requireAdmin(req);
      if (!ctx.library.get(req.params.id)) throw new HttpProblem(404, "Game not found");
      const b = req.body ?? {};
      if (b.controllerSupport != null && !["full", "partial", "none"].includes(b.controllerSupport)) {
        throw new HttpProblem(400, "controllerSupport is full, partial, none or null");
      }
      ctx.library.setOverrides(req.params.id, { title: b.title, kidSafe: b.kidSafe, controller: b.controllerSupport });
      return ctx.library.get(req.params.id);
    },
  );

  app.get("/api/metadata/status", async (req) => {
    requireAdmin(req);
    return ctx.metadata.status();
  });

  app.post<{ Body: { force?: boolean } }>("/api/metadata/refresh", async (req) => {
    requireAdmin(req);
    return { queued: ctx.metadata.queueMissing(ctx.library.allScanned(), !!req.body?.force) };
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>("/api/games/:id/metadata/search", async (req) => {
    requireAdmin(req);
    const game = ctx.library.get(req.params.id);
    if (!game) throw new HttpProblem(404, "Game not found");
    return ctx.metadata.search(req.query.q || game.title);
  });

  app.put<{ Params: { id: string }; Body: { provider: string; providerId: string } }>("/api/games/:id/metadata", async (req) => {
    requireAdmin(req);
    if (!ctx.library.get(req.params.id)) throw new HttpProblem(404, "Game not found");
    await ctx.metadata.apply(req.params.id, req.body?.provider, String(req.body?.providerId ?? ""));
    return ctx.library.get(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/games/:id/metadata", async (req) => {
    requireAdmin(req);
    ctx.metadata.clear(req.params.id);
    return { ok: true };
  });

  // ---- Library ----------------------------------------------------------------

  app.get("/api/library/stats", async () => ctx.library.stats());

  app.post("/api/library/rescan", async (req) => {
    requireAdmin(req);
    await ctx.library.rescan();
    return ctx.library.stats();
  });
}

function artworkKind(k: string): "cover" | "background" {
  if (k !== "cover" && k !== "background") throw new HttpProblem(404, "Artwork is cover or background");
  return k;
}
