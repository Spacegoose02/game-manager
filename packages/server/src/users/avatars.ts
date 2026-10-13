import { createHash, randomBytes } from "node:crypto";

// Simple gaming icons on a 64x64 canvas, drawn in the foreground colour.
const ICONS: Record<string, string> = {
  controller:
    '<path d="M18 24h28a10 10 0 0 1 9.6 7.2l3 11A6 6 0 0 1 48 46l-5-6H21l-5 6a6 6 0 0 1-10.6-3.8l3-11A10 10 0 0 1 18 24z"/><g fill="BG"><rect x="16" y="29" width="3" height="10"/><rect x="12.5" y="32.5" width="10" height="3"/><circle cx="42" cy="31" r="2.2"/><circle cx="47" cy="36" r="2.2"/></g>',
  joystick:
    '<rect x="14" y="42" width="36" height="10" rx="4"/><rect x="30" y="22" width="4" height="22"/><circle cx="32" cy="18" r="8"/><circle cx="22" cy="47" r="2" fill="BG"/>',
  invader:
    '<path d="M20 16h4v4h-4zM40 16h4v4h-4zM24 20h16v4H24zM20 24h24v4H20zM16 28h8v4h-8zM28 28h8v4h-8zM40 28h8v4h-8zM12 32h40v4H12zM12 36h4v8h-4zM20 36h24v4H20zM48 36h4v8h-4zM20 40h4v4h-4zM40 40h4v4h-4zM24 44h6v4h-6zM34 44h6v4h-6z"/>',
  ghost:
    '<path d="M16 30a16 16 0 0 1 32 0v20l-5.3-4-5.4 4-5.3-4-5.3 4-5.4-4L16 50z"/><circle cx="26" cy="30" r="3.5" fill="BG"/><circle cx="38" cy="30" r="3.5" fill="BG"/>',
  sword:
    '<path d="M44 12h8v8L30 42l-8-8z"/><path d="M16 36l12 12-4 4-3-3-5 5-4-4 5-5-3-3z"/>',
  potion:
    '<rect x="27" y="10" width="10" height="6" rx="1"/><path d="M28 16h8v8l9 12a12 12 0 0 1-9.6 18h-6.8A12 12 0 0 1 19 36l9-12z"/><circle cx="29" cy="40" r="3" fill="BG"/>',
  heart:
    '<path d="M32 52 13 33a10.5 10.5 0 0 1 15-15l4 4 4-4a10.5 10.5 0 0 1 15 15z"/>',
  dice:
    '<path d="M32 8 53 20v24L32 56 11 44V20z"/><path d="M32 8 53 20 32 32 11 20z" fill="BG" opacity=".35"/><circle cx="32" cy="20" r="2.5" fill="BG"/><circle cx="22" cy="38" r="2.5" fill="BG"/><circle cx="42" cy="38" r="2.5" fill="BG"/>',
  mushroom:
    '<path d="M10 32a22 22 0 0 1 44 0z"/><rect x="24" y="32" width="16" height="16" rx="4"/><circle cx="24" cy="22" r="4" fill="BG"/><circle cx="40" cy="22" r="4" fill="BG"/>',
  rocket:
    '<path d="M32 8c8 6 12 16 12 26l-4 10H24l-4-10C20 24 24 14 32 8z"/><circle cx="32" cy="28" r="4" fill="BG"/><path d="M24 44l-6 8 10-3zM40 44l6 8-10-3z"/>',
};

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

export function randomAvatarSeed(): string {
  return randomBytes(6).toString("hex");
}

/** Deterministic SVG avatar for a seed: same seed, same picture. */
export function avatarSvg(seed: string): string {
  const h = createHash("sha256").update(seed).digest();
  const names = Object.keys(ICONS);
  const icon = ICONS[names[h[0]! % names.length]!]!;
  const [bg, fg] = PALETTES[h[1]! % PALETTES.length]!;
  const rotate = (h[2]! % 21) - 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128"><rect width="64" height="64" rx="14" fill="${bg}"/><g fill="${fg}" transform="rotate(${rotate} 32 32)">${icon.replaceAll("BG", bg)}</g></svg>`;
}
