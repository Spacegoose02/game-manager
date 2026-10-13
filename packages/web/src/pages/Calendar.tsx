import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { GameListing } from "@lootden/shared";
import { api, type ListingResult } from "../api";
import { useAuth } from "../auth";

const RANGES = [30, 90, 180] as const;

/** Upcoming releases grouped by month, then by day. */
export function Calendar() {
  const { me } = useAuth();
  const [days, setDays] = useState<number>(90);
  const [platform, setPlatform] = useState<"pc" | "all">("pc");
  const [data, setData] = useState<ListingResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    setError("");
    api.calendar(days, platform).then(setData, (e: Error) => setError(e.message));
  }, [days, platform]);

  const months = useMemo(() => {
    const out = new Map<string, { dated: Map<string, GameListing[]>; vague: GameListing[] }>();
    const later: GameListing[] = [];
    for (const item of data?.items ?? []) {
      if (!item.releaseDate) {
        later.push(item);
        continue;
      }
      const month = item.releaseDate.slice(0, 7);
      if (!out.has(month)) out.set(month, { dated: new Map(), vague: [] });
      const m = out.get(month)!;
      m.dated.set(item.releaseDate, [...(m.dated.get(item.releaseDate) ?? []), item]);
    }
    return { months: [...out.entries()], later };
  }, [data]);

  return (
    <div className="calendar">
      <div className="inline" style={{ justifyContent: "space-between" }}>
        <h1>Release calendar</h1>
        <div className="inline">
          <div className="segmented" role="tablist" aria-label="Platforms">
            {(["pc", "all"] as const).map((p) => (
              <button key={p} role="tab" aria-selected={platform === p} className={platform === p ? "active" : ""} onClick={() => setPlatform(p)}>
                {p === "pc" ? "PC" : "All platforms"}
              </button>
            ))}
          </div>
          <div className="segmented" role="tablist" aria-label="Range">
            {RANGES.map((d) => (
              <button key={d} role="tab" aria-selected={days === d} className={days === d ? "active" : ""} onClick={() => setDays(d)}>
                {d === 30 ? "Month" : d === 90 ? "3 months" : "6 months"}
              </button>
            ))}
          </div>
        </div>
      </div>
      {data && (
        <p className="muted small">
          From {data.source}.
          {data.source === "Steam" &&
            (me?.role === "admin" ? (
              <>
                {" "}
                Steam only lists PC games and often has no exact date; add an IGDB or RAWG key under <Link to="/admin">Admin</Link> for a fuller calendar.
              </>
            ) : (
              " Steam only lists PC games."
            ))}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.items.length === 0 && <p className="muted">Nothing announced for this range.</p>}
      {months.months.map(([month, m]) => (
        <section key={month} className="cal-month">
          <h2>{new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
          {[...m.dated.entries()].map(([date, items]) => (
            <div key={date} className="cal-day">
              <div className="cal-date">
                <span className="cal-dow">{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span className="cal-num">{Number(date.slice(8))}</span>
              </div>
              <div className="cal-games">
                {items.map((i) => (
                  <CalendarGame key={`${i.provider}:${i.providerId}`} item={i} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
      {months.later.length > 0 && (
        <section className="cal-month">
          <h2>Date to be confirmed</h2>
          <div className="cal-games loose">
            {months.later.map((i) => (
              <CalendarGame key={`${i.provider}:${i.providerId}`} item={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CalendarGame({ item }: { item: GameListing }) {
  const image = item.coverUrl ?? item.imageUrl;
  const inner = (
    <>
      {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className={item.coverUrl ? "cal-cover" : "cal-wide"} /> : <span className="cal-cover blank" />}
      <span>
        <strong>{item.name}</strong>
        <span className="muted small">{[item.dateText, item.platforms.slice(0, 4).join(", "), item.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</span>
        {item.libraryId && <span className="tag in-library">In library</span>}
      </span>
    </>
  );
  if (item.libraryId) return <Link to={`/games/${item.libraryId}`} className="cal-game">{inner}</Link>;
  return item.url ? (
    <a href={item.url} target="_blank" rel="noreferrer" className="cal-game">
      {inner}
    </a>
  ) : (
    <div className="cal-game">{inner}</div>
  );
}
