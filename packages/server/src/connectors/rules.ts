import { titleKey } from "../metadata/calendar.js";
import { cleanTitle } from "../metadata/titles.js";
import type { SearchResult } from "./prowlarr.js";
import type { ReleaseRules } from "./settings.js";

export interface Judged {
  /** False when a rule rules it out; `reason` says which. */
  allowed: boolean;
  reason: string | null;
  /** Higher is better among allowed releases. */
  score: number;
  best?: boolean;
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const has = (title: string, word: string) => words(title).includes(words(word));

/**
 * Applies the release rules to one search result. With `wantedTitle` (auto-grab), the release
 * must also be that game: "Hades" doesn't take "Hades II", and DLC or soundtrack packs don't count.
 */
export function judgeRelease(r: SearchResult, rules: ReleaseRules, wantedTitle?: string): Judged {
  const no = (reason: string): Judged => ({ allowed: false, reason, score: 0 });
  if (rules.blockedIndexers.some((i) => i.toLowerCase() === r.indexer.toLowerCase())) return no(`${r.indexer} is blocked`);
  const missing = rules.mustContain.find((w) => !has(r.title, w));
  if (missing) return no(`Doesn't mention "${missing}"`);
  const bad = rules.mustNotContain.find((w) => has(r.title, w));
  if (bad) return no(`Mentions "${bad}"`);
  const mb = r.sizeBytes / 1024 / 1024;
  if (rules.minSizeMb && mb < rules.minSizeMb) return no(`Smaller than ${rules.minSizeMb} MB`);
  if (rules.maxSizeMb && mb > rules.maxSizeMb) return no(`Bigger than ${rules.maxSizeMb} MB`);
  if (r.protocol === "torrent" && r.seeders != null && r.seeders < rules.minSeeders) return no(`Fewer than ${rules.minSeeders} seeders`);
  if (wantedTitle && titleKey(cleanTitle(r.title).query) !== titleKey(cleanTitle(wantedTitle).query)) return no(`Not "${wantedTitle}"`);

  let score = 0;
  // Earlier preferred words count for more.
  rules.preferred.forEach((w, i) => {
    if (has(r.title, w)) score += (rules.preferred.length - i) * 1000;
  });
  if (rules.preferProtocol !== "any" && r.protocol === rules.preferProtocol) score += 500;
  score += Math.min(r.seeders ?? (r.protocol === "usenet" ? 50 : 0), 200);
  return { allowed: true, reason: null, score };
}
