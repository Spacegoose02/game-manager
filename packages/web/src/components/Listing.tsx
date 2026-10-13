import { Link } from "react-router-dom";
import type { GameListing } from "@lootden/shared";

export const listingDate = (l: GameListing) =>
  l.releaseDate ? new Date(`${l.releaseDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : (l.dateText ?? "TBA");

/** A game from IGDB/RAWG/Steam that may or may not be in the library. */
export function ListingCard({ item, action }: { item: GameListing; action?: React.ReactNode }) {
  const image = item.imageUrl ?? item.coverUrl;
  const body = (
    <>
      <span className="listing-image">
        {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="listing-blank">{item.name.slice(0, 1)}</span>}
        {item.libraryId && <span className="tag in-library">In library</span>}
      </span>
      <span className="listing-body">
        <span className="card-title">{item.name}</span>
        <span className="card-meta">
          {listingDate(item)}
          {item.genres[0] ? ` · ${item.genres[0]}` : ""}
        </span>
      </span>
    </>
  );
  return (
    <div className="listing">
      {item.libraryId ? (
        <Link to={`/games/${item.libraryId}`} className="listing-link">
          {body}
        </Link>
      ) : item.url ? (
        <a href={item.url} target="_blank" rel="noreferrer" className="listing-link">
          {body}
        </a>
      ) : (
        <div className="listing-link">{body}</div>
      )}
      {action}
    </div>
  );
}

export function ListingRow({ title, items, more }: { title: string; items: GameListing[]; more?: { to: string; label: string } }) {
  if (!items.length) return null;
  return (
    <section className="row">
      <div className="row-head">
        <h2>{title}</h2>
        {more && (
          <Link to={more.to} className="muted small">
            {more.label}
          </Link>
        )}
      </div>
      <div className="row-track listings">
        {items.map((i) => (
          <ListingCard key={`${i.provider}:${i.providerId}`} item={i} />
        ))}
      </div>
    </section>
  );
}
