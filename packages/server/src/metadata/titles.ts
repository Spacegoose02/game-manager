/** Release-group, store and packaging tags that are noise when searching for a title. */
const NOISE =
  /\b(gog|steam|steamrip|drm[- ]?free|repack|fitgirl|dodi|elamigos|kaos|codex|plaza|skidrow|reloaded|cpy|empress|tenoke|rune|flt|razor1911|prophet|darksiders|portable|multi\d*|x64|x86|win(dows)?|setup|installer|update|patch|incl|dlcs?|all dlc|crack(ed)?|proper|iso)\b/gi;

export interface CleanTitle {
  query: string;
  year: number | null;
}

/** Turns a folder or archive name into a search query: "The.Sims.4.v1.98-GOG" -> "The Sims 4". */
export function cleanTitle(source: string): CleanTitle {
  let s = source.replace(/(\.part\d+)?\.(zip|7z|rar)(\.\d{3})?$/i, "");
  const yearMatch = s.match(/[([]((19|20)\d{2})[)\]]/) ?? s.match(/[ ._]((19|20)\d{2})(?=$|[ ._)\]])/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  s = s
    .replace(/[([{].*?[)\]}]/g, " ") // bracketed tags
    .replace(/-[A-Za-z0-9]+$/, " ") // trailing -GROUP
    .replace(/\bv(ersion)?[ ._]?\d+([._]\d+)*[a-z]?\b/gi, " ") // v1.2.3, v1_2
    .replace(/[._]+/g, " ")
    .replace(/\bbuild\s?\d+\b/gi, " ")
    .replace(NOISE, " ")
    .replace(/\b(19|20)\d{2}\b(?!\s*\w)/g, (m) => (year && Number(m) === year ? " " : m))
    .replace(/\s+/g, " ")
    .trim();
  return { query: s || source, year };
}

function normalize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|a|an|of)\b/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" })[w] ?? w);
}

/** 0..1 similarity between two titles (token overlap, order-insensitive). */
export function titleSimilarity(a: string, b: string): number {
  const ta = normalize(a);
  const tb = normalize(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.join(" ") === tb.join(" ")) return 1;
  const setB = new Set(tb);
  const common = ta.filter((t) => setB.has(t)).length;
  return (2 * common) / (ta.length + tb.length);
}

/** Scores a candidate: title similarity, nudged by matching release year. */
export function matchScore(clean: CleanTitle, candidate: { name: string; year: number | null }): number {
  let score = titleSimilarity(clean.query, candidate.name);
  if (clean.year && candidate.year) score += clean.year === candidate.year ? 0.1 : -0.1;
  return Math.max(0, Math.min(1, score));
}
