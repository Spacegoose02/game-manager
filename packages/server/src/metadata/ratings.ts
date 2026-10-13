import type { AgeRating } from "@game-manager/shared";

// Ratings at or below these are treated as suitable for kids (roughly "ages 10 and under").
const KID_SAFE: Record<string, RegExp> = {
  ESRB: /^(RP|EC|E|E10\+?|EVERYONE( 10\+)?)$/i,
  PEGI: /^(PEGI ?)?(3|7|THREE|SEVEN)$/i,
  USK: /^(USK ?)?(0|6)$/i,
  CERO: /^(CERO ?)?A$/i,
  GRAC: /^(GRAC ?)?(ALL|ALL AGES)$/i,
  ACB: /^(ACB ?)?(G|PG)$/i,
  CLASS_IND: /^(L|10)$/i,
  STEAM: /^([0-9]|10)\+?$/,
};

/**
 * True when every known rating is kid-friendly, false when any says otherwise,
 * null when there is nothing to go on. Unknown games stay hidden from kid profiles.
 */
export function kidSafeFromRatings(ratings: AgeRating[]): boolean | null {
  let verdict: boolean | null = null;
  for (const r of ratings) {
    const org = r.organization.toUpperCase().replace(/[^A-Z_]/g, "");
    const pattern = KID_SAFE[org];
    if (!pattern) continue;
    if (!pattern.test(r.rating.trim())) return false;
    verdict = true;
  }
  return verdict;
}

/** Steam's required_age: 0 means unrated rather than "all ages", so only a positive value is informative. */
export function kidSafeFromRequiredAge(age: number | null | undefined): boolean | null {
  if (!age) return null;
  return age <= 10;
}
