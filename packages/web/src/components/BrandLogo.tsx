import { useId } from "react";

/** The raccoon's colours. Each is any CSS colour, including var(--accent). */
export interface LogoColors {
  furA: string;
  furB: string;
  line: string;
  couchA: string;
  couchB: string;
  pad: string;
  buttonA: string;
  buttonB: string;
}

/** Read from CSS variables (styles.css, .brand-logo), so a theme or style change recolours it in place. */
const FROM_CSS: LogoColors = {
  furA: "var(--logo-fur-a)",
  furB: "var(--logo-fur-b)",
  line: "var(--logo-line)",
  couchA: "var(--logo-couch-a)",
  couchB: "var(--logo-couch-b)",
  pad: "var(--logo-pad)",
  buttonA: "var(--logo-button-a)",
  buttonB: "var(--logo-button-b)",
};

/** A real raccoon: grey and white fur, black mask and rings, on a charcoal couch. Keep in step with styles.css. */
export const RACCOON: LogoColors = {
  furA: "#e4e6e9",
  furB: "#7d838b",
  line: "#141517",
  couchA: "#4a4e55",
  couchB: "#26282c",
  pad: "#ffffff",
  buttonA: "#9aa0a6",
  buttonB: "#d7dade",
};

/** The LootDen raccoon as SVG markup, in the given colours. */
export function logoSvg(c: LogoColors, id = "ld"): string {
  const g = `${id}-fur`;
  const couch = `${id}-couch`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%" aria-hidden="true">
<defs>
<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:${c.furA}"/><stop offset="1" style="stop-color:${c.furB}"/></linearGradient>
<linearGradient id="${couch}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${c.couchA}"/><stop offset="1" style="stop-color:${c.couchB}"/></linearGradient>
</defs>
<path d="M96 70 C110 60 113 40 105 26 C101 20 94 20 92 26" fill="none" stroke="url(#${g})" stroke-width="12" stroke-linecap="round"/>
<path d="M96 70 C110 60 113 40 105 26 C101 20 94 20 92 26" fill="none" style="stroke:${c.line}" stroke-width="12.5" stroke-dasharray="4 6" stroke-dashoffset="-8"/>
<g transform="translate(32 14)" fill="url(#${g})" style="stroke:${c.line}" stroke-width="1.5" paint-order="stroke">
<path fill-rule="evenodd" d="M32 55.5 L25 51.5 L17.5 49 L13 45 L7.5 42.5 L11.5 39.5 L8.5 35.5 L13 33.5 L12 26 C11 21 12.5 15.5 15 13 C17.5 10.5 21.5 12 23.5 15.5 Q32 12.5 40.5 15.5 C42.5 12 46.5 10.5 49 13 C51.5 15.5 53 21 52 26 L51 33.5 L55.5 35.5 L52.5 39.5 L56.5 42.5 L51 45 L46.5 49 L39 51.5 Z M30.6 17.5 L33.4 17.5 L33 27 L31 27 Z M14.5 30 C19 24 25 24.5 29 28 L32 30.5 L35 28 C39 24.5 45 24 49.5 30 C46 36.5 40 37 36 35 L32 38.5 L28 35 C24 37 18 36.5 14.5 30 Z M29 43 L35 43 L32 46.6 Z"/>
<circle cx="23" cy="30.4" r="2.5"/><circle cx="41" cy="30.4" r="2.5"/>
</g>
<g fill="url(#${couch})" style="stroke:${c.line}" stroke-width="3" paint-order="stroke" stroke-linejoin="round">
<rect x="10" y="64" width="108" height="36" rx="14"/>
<rect x="4" y="80" width="26" height="34" rx="10"/><rect x="98" y="80" width="26" height="34" rx="10"/>
<rect x="16" y="98" width="96" height="16" rx="5"/>
</g>
<path d="M22 69 H106" stroke="#ffffff" stroke-opacity="0.16" stroke-width="3" stroke-linecap="round"/>
<path d="M64 100 V113" style="stroke:${c.line}" stroke-opacity="0.55" stroke-width="2"/>
<g transform="translate(64 66) scale(1.35)">
<path style="fill:${c.pad};stroke:${c.line}" stroke-width="2" paint-order="stroke" d="M-15 -5 C-15 -8 -12 -9 -9 -9 L9 -9 C12 -9 15 -8 15 -5 L17 5 C18 9 14 11 11 8 L7 4 L-7 4 L-11 8 C-14 11 -18 9 -17 5 Z"/>
<rect x="-11" y="-4.2" width="7" height="2" rx="0.8" style="fill:${c.line}"/><rect x="-8.5" y="-6.6" width="2" height="7" rx="0.8" style="fill:${c.line}"/>
<circle cx="7" cy="-5" r="1.4" style="fill:${c.buttonA}"/><circle cx="10" cy="-2.6" r="1.4" style="fill:${c.buttonB}"/>
</g>
<g fill="url(#${g})" style="stroke:${c.line}" stroke-width="2.5" paint-order="stroke">
<ellipse cx="40" cy="69" rx="7" ry="5"/><ellipse cx="88" cy="69" rx="7" ry="5"/>
</g>
<g style="stroke:${c.line}" stroke-width="1.2" stroke-linecap="round" fill="none">
<path d="M37.5 66.5 V70 M40 66 V70.5 M42.5 66.5 V70"/><path d="M85.5 66.5 V70 M88 66 V70.5 M90.5 66.5 V70"/>
</g>
</svg>`;
}

export type LogoStyle = "theme" | "raccoon";

/** The colours as plain values (for the favicon, which can't read the page's CSS variables). */
function resolvedColors(style: LogoStyle): LogoColors {
  if (style === "raccoon") return RACCOON;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const light = document.documentElement.dataset.scheme === "light";
  const [accent, accent2, bg, panel, text] = [v("--accent"), v("--accent-2"), v("--bg"), v("--panel"), v("--text")];
  return {
    furA: accent2,
    furB: accent,
    line: light ? text : bg,
    couchA: `color-mix(in srgb, ${accent} 40%, ${panel})`,
    couchB: `color-mix(in srgb, ${accent} 22%, ${bg})`,
    pad: light ? "#ffffff" : text,
    buttonA: accent,
    buttonB: accent2,
  };
}

/** Redraws the browser tab icon in the current colours. */
export function updateFavicon(style: LogoStyle): void {
  if (!__BRAND__.raccoonFavicon) return;
  const href = `data:image/svg+xml,${encodeURIComponent(logoSvg(resolvedColors(style), "fav"))}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = href;
}

/** The logo in the top bar and on the sign-in page: the raccoon in the theme's colours, or your own logo file. */
export function BrandLogo({ size }: { size: number }) {
  const id = useId().replace(/[^a-zA-Z0-9-]/g, "");
  if (!__BRAND__.raccoon) return <img src={__BRAND__.logo ?? "/logo.svg"} alt="" width={size} height={size} />;
  return (
    <span
      className="brand-logo"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: logoSvg(FROM_CSS, `ld${id}`) }}
    />
  );
}
