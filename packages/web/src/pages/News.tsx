import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type NewsItem } from "../api";
import { useAuth } from "../auth";

export function News() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const { me } = useAuth();

  useEffect(() => {
    api.news().then(
      (r) => {
        setItems(r.items);
        setErrors(r.errors.map((e) => e.error));
      },
      (e: Error) => setErrors([e.message]),
    );
  }, []);

  if (!items) return <p className="muted">Loading…</p>;
  return (
    <>
      <h1>Gaming news</h1>
      {errors.length > 0 && <p className="error small">Some feeds failed: {errors.join("; ")}</p>}
      {items.length === 0 && (
        <p className="muted">
          No feeds yet.{" "}
          {me?.role === "admin" ? (
            <>
              Add RSS feeds under <Link to="/admin">Admin</Link>.
            </>
          ) : (
            "Ask an admin to add some."
          )}
        </p>
      )}
      <div className="news">
        {items.map((i) => (
          <a key={i.link + i.title} className="news-item panel" href={i.link} target="_blank" rel="noreferrer">
            {i.image && <img src={i.image} alt="" loading="lazy" />}
            <div>
              <p className="eyebrow">
                {i.feedTitle}
                {i.publishedAt ? ` · ${new Date(i.publishedAt).toLocaleDateString()}` : ""}
              </p>
              <h3>{i.title}</h3>
              <p className="muted small">{i.summary}</p>
            </div>
          </a>
        ))}
      </div>
    </>
  );
}
