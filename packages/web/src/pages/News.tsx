import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type NewsItem, type Video } from "../api";
import { useAuth } from "../auth";
import { VideoRow } from "../components/Videos";

export function News() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const { me } = useAuth();
  const [tab, setTab] = useState<"articles" | "videos">("articles");
  const [videos, setVideos] = useState<{ groups: Array<{ id: string; title: string; videos: Video[] }>; errors: string[] } | null>(null);

  useEffect(() => {
    if (tab === "videos" && !videos) api.videos().then(setVideos, (e: Error) => setVideos({ groups: [], errors: [e.message] }));
  }, [tab, videos]);

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
      <div className="inline" style={{ justifyContent: "space-between" }}>
        <h1>Gaming news</h1>
        <div className="segmented" role="tablist">
          {(["articles", "videos"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "articles" ? "Articles" : "Videos"}
            </button>
          ))}
        </div>
      </div>
      {tab === "videos" && (
        <>
          {!videos && <p className="muted">Loading…</p>}
          {videos?.errors.length ? <p className="error small">Some channels failed: {videos.errors.join("; ")}</p> : null}
          {videos?.groups.map((g) => <VideoRow key={g.id} title={g.title} videos={g.videos} />)}
          {videos && videos.groups.length === 0 && <p className="muted">No video rows yet.{me?.role === "admin" ? " Add YouTube channels under Admin." : ""}</p>}
        </>
      )}
      {tab === "articles" && (
      <>
      {errors.length > 0 && <p className="error small">Some feeds failed: {errors.join("; ")}</p>}
      {items.length === 0 && (
        <p className="muted">
          No feeds yet.{" "}
          {me?.role === "admin" ? (
            <>
              Add RSS feeds in <Link to="/settings/content">Settings</Link>.
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
      )}
    </>
  );
}
