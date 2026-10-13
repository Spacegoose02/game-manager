import type { IgdbProvider } from "./igdb.js";

export interface TimeToBeat {
  /** Hours, rounded to the half hour; null when IGDB has no answer. */
  main: number | null;
  normally: number | null;
  completely: number | null;
  count: number;
}

const hours = (s?: number | null) => (s ? Math.round((s / 3600) * 2) / 2 : null);

/** How long a game takes, from IGDB's player-submitted times (game_time_to_beats). */
export function timeToBeat(igdb: IgdbProvider) {
  const cache = new Map<string, TimeToBeat | null>();
  return async (providerId: string | null, title: string): Promise<TimeToBeat | null> => {
    const key = providerId ?? `t:${title.toLowerCase()}`;
    if (cache.has(key)) return cache.get(key)!;
    let id = providerId && /^\d+$/.test(providerId) ? providerId : null;
    if (!id) {
      const found = await igdb.raw<{ id: number }>("games", `search "${title.replace(/"/g, "")}"; fields id; limit 1;`);
      id = found[0] ? String(found[0].id) : null;
    }
    const rows = id ? await igdb.raw<{ hastily?: number; normally?: number; completely?: number; count?: number }>("game_time_to_beats", `fields hastily,normally,completely,count; where game_id = ${id};`) : [];
    const r = rows[0];
    const result = r ? { main: hours(r.hastily), normally: hours(r.normally), completely: hours(r.completely), count: r.count ?? 0 } : null;
    cache.set(key, result);
    return result;
  };
}
