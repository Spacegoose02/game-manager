import { useEffect, useState } from "react";
import type { Video } from "../api";

const ago = (iso: string | null) => {
  if (!iso) return "";
  const h = (Date.now() - Date.parse(iso)) / 3600_000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : new Date(iso).toLocaleDateString();
};

/** A row of YouTube videos; clicking one plays it in place. */
export function VideoRow({ title, videos }: { title: string; videos: Video[] }) {
  const [playing, setPlaying] = useState<Video | null>(null);
  if (!videos.length) return null;
  return (
    <section className="row">
      <h2>{title}</h2>
      <div className="row-track videos">
        {videos.map((v) => (
          <button key={v.id} className="video-card" onClick={() => setPlaying(v)} aria-label={`Play ${v.title}`}>
            <span className="video-thumb">
              <img src={v.thumbnail} alt="" loading="lazy" />
              <span className="play" aria-hidden>
                ▶
              </span>
            </span>
            <span className="video-title">{v.title}</span>
            <span className="muted small">
              {v.channel} · {ago(v.publishedAt)}
            </span>
          </button>
        ))}
      </div>
      {playing && <VideoPlayer video={playing} onClose={() => setPlaying(null)} />}
    </section>
  );
}

export function VideoPlayer({ video, onClose }: { video: Video; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-label={video.title} onClick={onClose}>
      <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
        <div className="video-frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
            title={video.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <strong>{video.title}</strong>
          <span className="inline">
            <a className="button" href={video.url} target="_blank" rel="noreferrer">
              Open on YouTube
            </a>
            <button onClick={onClose} autoFocus>
              Close
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
