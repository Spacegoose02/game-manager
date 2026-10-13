import { useEffect, useRef, useState } from "react";
import { api, type VideoGroup } from "../api";

type Draft = { id?: string; title: string; intervalMinutes: number; channels: string };

/** Admin: YouTube rows for the news and home pages, each a list of channels. */
export function AdminVideos({ onMessage }: { onMessage: (m: string) => void }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const report = useRef(onMessage);
  report.current = onMessage;

  const toDrafts = (groups: VideoGroup[]) =>
    groups.map((g) => ({ id: g.id, title: g.title, intervalMinutes: g.intervalMinutes, channels: g.channels.map((c) => `${c.id}  # ${c.name}`).join("\n") }));

  useEffect(() => {
    api.videoGroups().then((g) => setDrafts(toDrafts(g)), (e: Error) => report.current(e.message));
  }, []);

  if (!drafts) return null;
  const update = (i: number, patch: Partial<Draft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = async () => {
    setBusy(true);
    try {
      const groups = await api.saveVideoGroups(
        drafts.map((d) => ({
          id: d.id,
          title: d.title,
          intervalMinutes: d.intervalMinutes,
          channels: d.channels
            .split("\n")
            .map((l) => l.replace(/#.*$/, "").trim())
            .filter(Boolean),
        })),
      );
      setDrafts(toDrafts(groups));
      onMessage("Video rows saved.");
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>YouTube videos</h2>
      <p className="muted small">
        Each row shows the newest videos from its channels on the News and Home pages. One channel per line: a channel id (UC…), an @handle or a channel link.
      </p>
      {drafts.map((d, i) => (
        <div key={d.id ?? i} className="video-group">
          <div className="inline">
            <input value={d.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="Row title, e.g. Game Reviews" style={{ flex: 1 }} />
            <label className="inline small">
              Check every
              <select value={d.intervalMinutes} onChange={(e) => update(i, { intervalMinutes: Number(e.target.value) })}>
                {[30, 60, 180, 360, 720, 1440].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </select>
            </label>
            <button className="danger" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>
              Remove row
            </button>
          </div>
          <textarea rows={Math.max(3, d.channels.split("\n").length + 1)} value={d.channels} onChange={(e) => update(i, { channels: e.target.value })} placeholder={"@IGN\nUCjBp_7RuDBUYbd1LegWEJ8g"} />
        </div>
      ))}
      <div className="inline">
        <button onClick={() => setDrafts([...drafts, { title: "", intervalMinutes: 60, channels: "" }])}>Add row</button>
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? "Looking up channels…" : "Save"}
        </button>
      </div>
    </section>
  );
}
