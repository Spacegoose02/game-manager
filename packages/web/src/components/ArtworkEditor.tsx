import { useRef, useState } from "react";
import type { GameDetail } from "@lootden/shared";
import { api, type ArtworkOption } from "../api";

const LABEL = { cover: "Cover", background: "Background" } as const;

/** Admin: replace a game's cover or background with an upload, a URL, or SteamGridDB art. */
export function ArtworkEditor({ game, onChange }: { game: GameDetail; onChange: (g: GameDetail) => void }) {
  const [kind, setKind] = useState<"cover" | "background">("cover");
  const [options, setOptions] = useState<ArtworkOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const apply = (fn: () => Promise<GameDetail>) => run(async () => onChange(await fn()));
  const override = game.overrides[kind];
  const current = kind === "cover" ? game.coverUrl : game.backgroundUrl;

  return (
    <div className="artwork">
      <h3>Artwork</h3>
      <div className="inline">
        <div className="segmented" role="tablist">
          {(["cover", "background"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "active" : ""} onClick={() => (setKind(k), setOptions(null))}>
              {LABEL[k]}
            </button>
          ))}
        </div>
        <small className="muted">{override ? "Custom image set" : current ? "From metadata" : "None yet"}</small>
      </div>
      <div className="artwork-current">
        {current ? <img src={current} alt="" className={kind === "cover" ? "art-cover" : "art-bg"} /> : <span className="muted small">No {kind}.</span>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="inline">
        <button disabled={busy} onClick={() => file.current?.click()}>
          Upload image
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void apply(() => api.uploadArtwork(game.id, kind, f));
          }}
        />
        <button disabled={busy} onClick={() => run(async () => setOptions(await api.artworkOptions(game.id, kind, query)))}>
          Find artwork
        </button>
        <input placeholder="Search name (optional)" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 180 }} />
        {override && (
          <button className="ghost" disabled={busy} onClick={() => apply(() => api.resetArtwork(game.id, kind))}>
            Reset to metadata
          </button>
        )}
      </div>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void apply(() => api.setArtworkUrl(game.id, kind, url.trim())).then(() => setUrl(""));
        }}
      >
        <input placeholder="…or paste an image URL" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button disabled={busy || !url.trim()}>Use URL</button>
      </form>
      {options && (
        <div className={`art-options art-options-${kind}`}>
          {options.length === 0 && <p className="muted small">Nothing found. Add a SteamGridDB key in Settings, Sign-in &amp; services for many more choices.</p>}
          {options.map((o) => (
            <button key={o.url} className="art-option" disabled={busy} title={o.source} onClick={() => apply(() => api.setArtworkUrl(game.id, kind, o.url)).then(() => setOptions(null))}>
              <img src={o.thumb} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
