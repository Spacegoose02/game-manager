import type { AgeRating, GameInfo } from "@lootden/shared";
import { igdbImage } from "./igdb.js";
import type { MetadataService } from "./service.js";
import { steamCover, steamHeader } from "./steam.js";

interface IgdbFull {
  id: number;
  name: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number;
  total_rating?: number;
  cover?: { image_id: string };
  artworks?: Array<{ image_id: string }>;
  screenshots?: Array<{ image_id: string }>;
  videos?: Array<{ video_id: string; name?: string }>;
  genres?: Array<{ name: string }>;
  platforms?: Array<{ abbreviation?: string; name?: string }>;
  involved_companies?: Array<{ developer?: boolean; company?: { name?: string } }>;
  url?: string;
}

const strip = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Prefers an official trailer over teasers, gameplay and the rest. */
function pickTrailer<T extends { name?: string }>(videos: T[]): T | undefined {
  return videos.find((v) => /launch trailer/i.test(v.name ?? "")) ?? videos.find((v) => /trailer/i.test(v.name ?? "")) ?? videos[0];
}

/**
 * Full details for one game from the service that listed it, so Discover can show a page
 * inside LootDen instead of sending people to the service's site.
 */
export async function gameInfo(metadata: MetadataService, provider: string, id: string): Promise<GameInfo | null> {
  if (!/^\d+$/.test(id)) return null;
  if (provider === "igdb") {
    if (!metadata.igdb.enabled) throw new Error("IGDB isn't set up; add its keys under Admin");
    const [g] = await metadata.igdb.raw<IgdbFull>(
      "games",
      `fields name,summary,storyline,first_release_date,total_rating,cover.image_id,artworks.image_id,screenshots.image_id,videos.video_id,videos.name,genres.name,platforms.abbreviation,platforms.name,involved_companies.developer,involved_companies.company.name,url; where id = ${id};`,
    );
    if (!g) return null;
    const wide = g.artworks?.[0] ?? g.screenshots?.[0];
    const video = pickTrailer(g.videos ?? []);
    return {
      provider,
      providerId: id,
      name: g.name,
      releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
      dateText: g.first_release_date ? null : "TBA",
      coverUrl: g.cover ? igdbImage(g.cover.image_id, "t_cover_big") : null,
      imageUrl: wide ? igdbImage(wide.image_id, "t_1080p") : null,
      platforms: (g.platforms ?? []).map((p) => p.abbreviation ?? p.name ?? "").filter(Boolean),
      genres: (g.genres ?? []).map((x) => x.name),
      url: g.url ?? null,
      libraryId: null,
      summary: g.summary ?? g.storyline ?? null,
      screenshots: (g.screenshots ?? []).slice(0, 10).map((s) => igdbImage(s.image_id, "t_1080p")),
      trailer: video ? { youtubeId: video.video_id } : null,
      rating: g.total_rating != null ? Math.round(g.total_rating) : null,
      developers: (g.involved_companies ?? []).filter((c) => c.developer && c.company?.name).map((c) => c.company!.name!),
      ageRatings: [],
    };
  }
  if (provider === "rawg") {
    if (!metadata.rawg.enabled) throw new Error("RAWG isn't set up; add its key under Admin");
    const [g, shots, movies] = await Promise.all([
      metadata.rawg.raw<{
        id: number;
        name: string;
        slug?: string;
        released?: string | null;
        tba?: boolean;
        background_image?: string | null;
        description_raw?: string;
        metacritic?: number | null;
        rating?: number;
        genres?: Array<{ name: string }>;
        platforms?: Array<{ platform: { name: string } }>;
        developers?: Array<{ name: string }>;
        esrb_rating?: { name?: string } | null;
      }>(`/games/${id}`),
      metadata.rawg.raw<{ results?: Array<{ image: string }> }>(`/games/${id}/screenshots`).catch(() => ({ results: [] })),
      metadata.rawg.raw<{ results?: Array<{ name?: string; preview?: string; data?: { max?: string; "480"?: string } }> }>(`/games/${id}/movies`).catch(() => ({ results: [] })),
    ]);
    const movie = pickTrailer(movies.results ?? []);
    const ageRatings: AgeRating[] = g.esrb_rating?.name ? [{ organization: "ESRB", rating: g.esrb_rating.name }] : [];
    return {
      provider,
      providerId: id,
      name: g.name,
      releaseDate: g.released ?? null,
      dateText: g.released ? null : "TBA",
      coverUrl: null,
      imageUrl: g.background_image ?? null,
      platforms: (g.platforms ?? []).map((p) => p.platform.name),
      genres: (g.genres ?? []).map((x) => x.name),
      url: g.slug ? `https://rawg.io/games/${g.slug}` : null,
      libraryId: null,
      summary: g.description_raw?.trim() || null,
      screenshots: (shots.results ?? []).slice(0, 10).map((s) => s.image),
      trailer: movie?.data?.max || movie?.data?.["480"] ? { url: (movie.data.max ?? movie.data["480"])!, poster: movie.preview ?? null } : null,
      rating: g.metacritic ?? (g.rating ? Math.round(g.rating * 20) : null),
      developers: (g.developers ?? []).map((d) => d.name),
      ageRatings,
    };
  }
  if (provider === "steam") {
    const d = await metadata.steam.details(id);
    if (!d) return null;
    const parsed = d.release_date?.date ? new Date(`${d.release_date.date} UTC`) : null;
    const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
    const movie = pickTrailer(d.movies ?? []);
    const file = movie?.mp4?.max ?? movie?.mp4?.["480"] ?? movie?.webm?.max ?? movie?.webm?.["480"];
    const age = Number(d.required_age) || 0;
    return {
      provider,
      providerId: id,
      name: d.name,
      releaseDate: date,
      dateText: date ? null : d.release_date?.date || "Coming soon",
      coverUrl: steamCover(id),
      imageUrl: d.screenshots?.[0]?.path_full ?? steamHeader(id),
      platforms: ["PC"],
      genres: (d.genres ?? []).map((g) => g.description),
      url: `https://store.steampowered.com/app/${id}/`,
      libraryId: null,
      summary: d.short_description ? strip(d.short_description) : null,
      screenshots: (d.screenshots ?? []).slice(0, 10).map((s) => s.path_full),
      trailer: file ? { url: file, poster: movie?.thumbnail ?? null } : null,
      rating: d.metacritic?.score ?? null,
      developers: d.developers ?? [],
      ageRatings: age > 0 ? [{ organization: "STEAM", rating: `${age}+` }] : [],
    };
  }
  return null;
}
