import { useMemo, useState } from "react";
import { useAuth } from "../auth";
import { FindDownloads } from "./FindDownloads";

/** Release sites searched by title, newest first, in a new tab (the desktop app opens them in the browser). */
const SITES: Array<{ name: string; url: (q: string) => string }> = [
  { name: "1337x", url: (q) => `https://1337x.to/sort-category-search/${encodeURIComponent(q)}/Games/time/desc/1/` },
];

/** Plain title for searching: "Cool Game: Deluxe Edition (2021)" → "Cool Game Deluxe Edition". */
export const searchTitle = (title: string) =>
  title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[:™®©]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Next to Play and Install: look up the latest releases of this game, in Prowlarr (admins,
 * newest first, with Get buttons) and on release sites.
 */
export function ReleaseLookup({ title, autoOpen = false }: { title: string; autoOpen?: boolean }) {
  const { me } = useAuth();
  const admin = me?.role === "admin";
  const [open, setOpen] = useState(autoOpen && admin);
  const q = searchTitle(title);
  const game = useMemo(() => ({ name: q }), [q]);
  if (me?.user?.kidMode) return null;
  return (
    <>
      <div className="inline release-lookup">
        <span className="muted small">Latest releases:</span>
        {admin && (
          <button className="small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide Prowlarr" : "Search Prowlarr"}
          </button>
        )}
        {SITES.map((s) => (
          <a key={s.name} className="button small ghost" href={s.url(q)} target="_blank" rel="noreferrer">
            {s.name} ↗
          </a>
        ))}
      </div>
      {open && <FindDownloads game={game} newestFirst onClose={() => setOpen(false)} />}
    </>
  );
}
