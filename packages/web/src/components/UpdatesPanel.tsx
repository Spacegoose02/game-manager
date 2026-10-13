import { useEffect, useState } from "react";
import { api, type GameUpdate } from "../api";

/** The developer's latest announcements and patch notes, from Steam. */
export function UpdatesPanel({ gameId }: { gameId: string }) {
  const [items, setItems] = useState<GameUpdate[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    setItems([]);
    api.gameUpdates(gameId).then((r) => setItems(r.items), () => setItems([]));
  }, [gameId]);

  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 3);
  return (
    <section className="panel updates">
      <h2>Latest updates</h2>
      <ul className="list">
        {shown.map((u, i) => (
          <li key={u.url} className="update">
            <button className="update-head" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span>
                <strong>{u.title}</strong>
                {u.patchNotes && <span className="badge small">Patch notes</span>}
              </span>
              <small className="muted">{new Date(u.date).toLocaleDateString()}</small>
            </button>
            {open === i && (
              <div className="update-body">
                <p>{u.body || "No text in this post."}</p>
                <a href={u.url} target="_blank" rel="noreferrer" className="small">
                  Read on Steam
                </a>
              </div>
            )}
          </li>
        ))}
      </ul>
      {items.length > 3 && (
        <button className="ghost small" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}
