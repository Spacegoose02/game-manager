import { createHash, randomBytes } from "node:crypto";

// Raccoon avatars on a 64x64 canvas, built from a seed: fur, background, eyes, mouth and
// an accessory are each picked from a byte of the seed's hash, so a seed always draws the
// same raccoon and existing seeds keep a stable picture.

/** [fur, mask and nose, white patches] */
const FURS: Array<[string, string, string]> = [
  ["#8d8f99", "#2b2b33", "#f1efe9"],
  ["#9b8574", "#2e2420", "#f5ece2"],
  ["#b4b9c4", "#33363f", "#ffffff"],
  ["#b07a52", "#3b2417", "#f7e6d3"],
  ["#5d6170", "#1c1d24", "#e6e6ea"],
  ["#9a8fb8", "#2a2340", "#f3effc"],
  ["#7fa89a", "#1f302b", "#eef8f4"],
  ["#a39382", "#262019", "#fbf5ec"],
];

/** [background, accent for accessories] */
const PALETTES: Array<[string, string]> = [
  ["#1b1f3b", "#7cf5ff"],
  ["#2b0f3a", "#ff5ccd"],
  ["#0f2d1f", "#59ff8a"],
  ["#3a1a0b", "#ffb347"],
  ["#10243f", "#ffd84d"],
  ["#2e0b14", "#ff5470"],
  ["#14213d", "#a3a8ff"],
  ["#062925", "#2ef2c2"],
];

const eye = (x: number, light: string, dark: string, kind: string): string => {
  switch (kind) {
    case "happy":
      return `<path d="M${x - 3} 36 Q${x} 32.4 ${x + 3} 36" fill="none" stroke="${light}" stroke-width="1.9" stroke-linecap="round"/>`;
    case "sleepy":
      return `<path d="M${x - 3} 35 Q${x} 37.6 ${x + 3} 35" fill="none" stroke="${light}" stroke-width="1.7" stroke-linecap="round"/>`;
    case "big":
      return `<circle cx="${x}" cy="35" r="3.8" fill="${light}"/><circle cx="${x + 0.4}" cy="35.4" r="2.4" fill="${dark}"/><circle cx="${x + 1.3}" cy="34.1" r="0.9" fill="${light}"/>`;
    default:
      return `<circle cx="${x}" cy="35" r="3.1" fill="${light}"/><circle cx="${x}" cy="35.3" r="1.8" fill="${dark}"/><circle cx="${x + 0.8}" cy="34.4" r="0.6" fill="${light}"/>`;
  }
};

const EYES: Array<[string, string]> = [
  ["open", "open"],
  ["big", "big"],
  ["happy", "happy"],
  ["open", "happy"],
  ["sleepy", "sleepy"],
  ["big", "open"],
];

const MOUTHS: Array<(dark: string) => string> = [
  (d) => `<path d="M27.5 45 Q32 49 36.5 45" fill="none" stroke="${d}" stroke-width="1.4" stroke-linecap="round"/>`,
  (d) => `<path d="M28 45 Q30 47.6 32 45 Q34 47.6 36 45" fill="none" stroke="${d}" stroke-width="1.4" stroke-linecap="round"/>`,
  (d) => `<path d="M28.5 45 Q32 51.5 35.5 45 Z" fill="${d}"/><ellipse cx="32" cy="48.2" rx="1.9" ry="1.2" fill="#ff8fa3"/>`,
  (d) => `<path d="M29 46 Q33 47.6 36.2 44.4" fill="none" stroke="${d}" stroke-width="1.4" stroke-linecap="round"/>`,
  (d) => `<path d="M27.5 45 Q32 49 36.5 45" fill="none" stroke="${d}" stroke-width="1.4" stroke-linecap="round"/><rect x="30.6" y="46.4" width="2.8" height="2.2" rx=".5" fill="#fff"/>`,
];

/** Accessories: [drawn before the head, drawn after it]. */
const ACCESSORIES: Array<(accent: string, dark: string) => [string, string]> = [
  () => ["", ""],
  () => ["", ""],
  // Headphones
  (a, d) => ["", `<path d="M11 31 Q11 8 32 8 Q53 8 53 31" fill="none" stroke="${d}" stroke-width="3.5"/><rect x="7" y="28" width="8" height="13" rx="3.5" fill="${a}"/><rect x="49" y="28" width="8" height="13" rx="3.5" fill="${a}"/>`],
  // Gaming headset with a mic
  (a, d) => ["", `<path d="M11 31 Q11 8 32 8 Q53 8 53 31" fill="none" stroke="${a}" stroke-width="3.5"/><rect x="7" y="28" width="8" height="13" rx="3.5" fill="${d}"/><rect x="49" y="28" width="8" height="13" rx="3.5" fill="${d}"/><path d="M11 39 Q13 51 23 51" fill="none" stroke="${d}" stroke-width="1.8"/><circle cx="24" cy="51" r="2.2" fill="${a}"/>`],
  // Cap
  (a) => ["", `<path d="M14 23 Q15 9 32 9 Q49 9 50 23 Z" fill="${a}"/><path d="M45 21 Q55 19.5 59 24 L49 24.5 Z" fill="${a}"/><circle cx="32" cy="9.5" r="1.6" fill="#fff" opacity=".8"/>`],
  // Crown
  () => ["", `<path d="M20 19 L21.5 8 L27 14 L32 5.5 L37 14 L42.5 8 L44 19 Z" fill="#ffd84d" stroke="#b8860b" stroke-width="1"/><circle cx="32" cy="14" r="1.6" fill="#ff5470"/>`],
  // Beanie
  (a) => ["", `<path d="M13 25 Q14 8 32 8 Q50 8 51 25 Z" fill="${a}"/><rect x="12" y="21" width="40" height="5.5" rx="2.7" fill="${a}" stroke="#000" stroke-opacity=".2"/><circle cx="32" cy="7" r="3.4" fill="#fff"/>`],
  // Bow
  (a) => ["", `<path d="M46 17 L38.5 12 L38.5 22 Z M46 17 L53.5 12 L53.5 22 Z" fill="${a}"/><circle cx="46" cy="17" r="2.2" fill="${a}" stroke="#000" stroke-opacity=".25"/>`],
  // Glasses
  (a) => ["", `<circle cx="23" cy="35" r="5.6" fill="none" stroke="${a}" stroke-width="1.8"/><circle cx="41" cy="35" r="5.6" fill="none" stroke="${a}" stroke-width="1.8"/><path d="M28.6 35 h6.8" stroke="${a}" stroke-width="1.8"/>`],
  // Scarf
  (a) => [`<path d="M12 51 Q32 61 52 51 L52 59 Q32 67 12 59 Z" fill="${a}"/>`, ""],
];

export function randomAvatarSeed(): string {
  return randomBytes(6).toString("hex");
}

/** Deterministic SVG raccoon for a seed: same seed, same picture. */
export function avatarSvg(seed: string): string {
  const h = createHash("sha256").update(seed).digest();
  const [fur, dark, light] = FURS[h[0]! % FURS.length]!;
  const [bg, accent] = PALETTES[h[1]! % PALETTES.length]!;
  const [left, right] = EYES[h[2]! % EYES.length]!;
  const mouth = MOUTHS[h[3]! % MOUTHS.length]!(dark);
  const [behind, front] = ACCESSORIES[h[4]! % ACCESSORIES.length]!(accent, dark);
  const tilt = (h[5]! % 13) - 6;
  const face = [
    behind,
    // Ears
    `<path d="M13 29 L16.5 10.5 L28 21 Z" fill="${fur}"/><path d="M51 29 L47.5 10.5 L36 21 Z" fill="${fur}"/>`,
    `<path d="M16.5 25 L18 15 L24.5 21 Z" fill="${dark}"/><path d="M47.5 25 L46 15 L39.5 21 Z" fill="${dark}"/>`,
    // Head, cheeks and muzzle
    `<ellipse cx="32" cy="37" rx="21" ry="17" fill="${fur}"/>`,
    `<ellipse cx="14.5" cy="42" rx="5" ry="6.5" fill="${light}"/><ellipse cx="49.5" cy="42" rx="5" ry="6.5" fill="${light}"/>`,
    `<ellipse cx="23" cy="27.5" rx="6.2" ry="2.6" fill="${light}"/><ellipse cx="41" cy="27.5" rx="6.2" ry="2.6" fill="${light}"/>`,
    `<path d="M29.5 20.5 Q32 19.5 34.5 20.5 L33.5 30 L30.5 30 Z" fill="${dark}"/>`,
    `<ellipse cx="32" cy="45" rx="11" ry="8.5" fill="${light}"/>`,
    // Bandit mask
    `<path d="M10.5 36 Q13.5 29 23 30 Q29 31 32 34 Q35 31 41 30 Q50.5 29 53.5 36 Q50 42.5 42 41.5 Q36 40.5 32 38.5 Q28 40.5 22 41.5 Q14 42.5 10.5 36 Z" fill="${dark}"/>`,
    eye(23, light, dark, left),
    eye(41, light, dark, right),
    `<ellipse cx="32" cy="41.2" rx="3.3" ry="2.3" fill="${dark}"/><ellipse cx="31" cy="40.5" rx="1" ry=".6" fill="#fff" opacity=".5"/>`,
    mouth,
    front,
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128"><rect width="64" height="64" rx="14" fill="${bg}"/><g transform="rotate(${tilt} 32 36)">${face}</g></svg>`;
}
