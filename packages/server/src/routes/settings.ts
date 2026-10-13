import type { FastifyInstance } from "fastify";
import { HttpProblem, requireAdmin, type AppContext } from "../context.js";
import type { IntegrationSettings } from "../settings/integrations.js";

export function settingsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/settings/integrations", async (req) => {
    requireAdmin(req);
    return ctx.integrations.view();
  });

  app.put<{ Body: Partial<IntegrationSettings> }>("/api/settings/integrations", async (req) => {
    requireAdmin(req);
    let view;
    try {
      view = ctx.integrations.save(req.body ?? {});
    } catch (err) {
      throw new HttpProblem(400, (err as Error).message);
    }
    ctx.metadata.configure();
    ctx.oidc.reset();
    return view;
  });

  app.post<{ Params: { name: string } }>("/api/settings/integrations/:name/test", async (req) => {
    requireAdmin(req);
    try {
      if (req.params.name === "oidc") {
        if (!ctx.config.oidc.issuer || !ctx.config.oidc.clientId) throw new Error("Enter the issuer and client ID first");
        const found = await ctx.oidc.test();
        return { message: ctx.config.publicUrl ? found : `${found}. Set the public address too, or the sign-in button stays hidden` };
      }
      return { message: await ctx.metadata.test(req.params.name) };
    } catch (err) {
      throw new HttpProblem(502, (err as Error).message);
    }
  });
}
