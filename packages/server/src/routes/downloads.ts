import type { FastifyInstance } from "fastify";
import { maskedConnectorSettings, saveConnectorSettings, type ConnectorSettings } from "../connectors/settings.js";
import { HttpProblem, requireAdmin, type AppContext } from "../context.js";

/** Admin-only: searching indexers, sending downloads to clients and importing results. */
export function downloadRoutes(app: FastifyInstance, ctx: AppContext) {
  const dm = ctx.downloads;
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpProblem) throw err;
      throw new HttpProblem(400, (err as Error).message);
    }
  };

  app.get("/api/connectors", async (req) => {
    requireAdmin(req);
    return maskedConnectorSettings(dm.settings());
  });

  app.put<{ Body: Partial<ConnectorSettings> }>("/api/connectors", async (req) => {
    requireAdmin(req);
    return wrap(async () => maskedConnectorSettings(saveConnectorSettings(ctx.db, req.body ?? {})));
  });

  app.post<{ Params: { name: string } }>("/api/connectors/:name/test", async (req) => {
    requireAdmin(req);
    if (!["qbittorrent", "transmission", "deluge", "sabnzbd", "prowlarr"].includes(req.params.name)) throw new HttpProblem(404, "Unknown connector");
    return wrap(async () => ({ ok: true, message: await dm.test(req.params.name) }));
  });

  app.get<{ Querystring: { q?: string } }>("/api/downloads/search", async (req) => {
    requireAdmin(req);
    if (!req.query.q?.trim()) throw new HttpProblem(400, "Search for something");
    return wrap(() => dm.search(req.query.q!.trim()));
  });

  app.post<{ Body: { url: string; title: string; protocol: "torrent" | "usenet"; platform?: string | null } }>("/api/downloads", async (req) => {
    const p = requireAdmin(req);
    const b = req.body ?? ({} as never);
    if (!b.url || !b.title || !["torrent", "usenet"].includes(b.protocol)) throw new HttpProblem(400, "url, title and protocol (torrent or usenet) are required");
    if (!/^(magnet:|https?:\/\/)/i.test(b.url)) throw new HttpProblem(400, "Only magnet links and http(s) URLs can be sent");
    return wrap(() => dm.grab(b, p.user?.id ?? null));
  });

  // Games already in the downloads folder: list, import with clean-up, or skip.
  app.get("/api/downloads/folder", async (req) => {
    requireAdmin(req);
    return wrap(async () => ({ folder: ctx.downloads.settings().import.folder, items: await dm.folderItems() }));
  });
  app.post<{ Body: { name?: string; platform?: string | null } }>("/api/downloads/folder/import", async (req) => {
    requireAdmin(req);
    if (!req.body?.name) throw new HttpProblem(400, "Which entry?");
    return wrap(async () => ({ target: await dm.importFromFolder(req.body.name!, req.body.platform ?? null) }));
  });
  app.post<{ Body: { name?: string } }>("/api/downloads/folder/skip", async (req) => {
    requireAdmin(req);
    if (!req.body?.name) throw new HttpProblem(400, "Which entry?");
    dm.skipFolderItem(req.body.name);
    return { ok: true };
  });

  app.get("/api/downloads", async (req) => {
    requireAdmin(req);
    void dm.reconcile().catch(() => {});
    return dm.list();
  });

  app.post<{ Params: { id: string }; Body: { action: "pause" | "resume" | "remove"; deleteFiles?: boolean } }>("/api/downloads/:id", async (req) => {
    requireAdmin(req);
    const action = req.body?.action;
    if (!["pause", "resume", "remove"].includes(action)) throw new HttpProblem(400, "action is pause, resume or remove");
    return wrap(async () => {
      await dm.control(Number(req.params.id), action, !!req.body?.deleteFiles);
      return { ok: true };
    });
  });
}
