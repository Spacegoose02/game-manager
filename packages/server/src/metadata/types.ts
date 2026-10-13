import type { AgeRating, ControllerSupport, Platform } from "@lootden/shared";

export interface Candidate {
  provider: string;
  providerId: string;
  name: string;
  year: number | null;
  coverUrl: string | null;
}

export interface ProviderResult {
  provider: string;
  providerId: string;
  name: string;
  summary: string | null;
  coverUrl: string | null;
  screenshots: string[];
  genres: string[];
  themes: string[];
  gameModes: string[];
  releaseDate: string | null;
  rating: number | null;
  ageRatings: AgeRating[];
  controllerSupport: ControllerSupport | null;
  steamAppId: string | null;
}

export interface MetadataProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** platform narrows the search to one system (emulated games); unset means PC. */
  search(query: string, platform?: Platform): Promise<Candidate[]>;
  fetch(id: string): Promise<ProviderResult | null>;
}
