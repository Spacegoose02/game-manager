import { useEffect, useRef, useState } from "react";
import type { GameDetail } from "@game-manager/shared";
import { formatBytes } from "../api";
import { bridgeError, desktop, useDesktopGame, type Drive } from "../desktop";

/** Install / play / uninstall panel shown inside the desktop app. */
export function DesktopInstall({ game, autoFocus }: { game: GameDetail; autoFocus: boolean }) {
  const { installed, progress, refresh, setProgress } = useDesktopGame(game.id);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!desktop) return;
    void Promise.all([desktop.info(), desktop.drives()]).then(([info, d]) => {
      setTarget(info.installDir);
      setDrives(d);
      if (info.installing.includes(game.id)) setBusy(true);
    });
  }, [game.id]);
  useEffect(() => {
    if (autoFocus) button.current?.focus();
  }, [autoFocus, installed]);

  if (!desktop) return null;
  const bridge = desktop;
  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(bridgeError(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const driveFor = (p: string) => drives.filter((d) => p.toLowerCase().startsWith(d.path.toLowerCase())).sort((a, b) => b.path.length - a.path.length)[0];
  const drive = driveFor(target);
  const lowSpace = drive && drive.freeBytes < game.sizeBytes * (game.packed ? 2 : 1);

  const p = progress;
  const downloading = busy && p?.type === "download";
  const pct = downloading ? (p.received / Math.max(1, p.total)) * 100 : 0;

  if (installed) {
    return (
      <div className="install panel">
        <div className="inline">
          <button ref={button} className="primary" disabled={p?.type === "playing"} onClick={() => run(() => bridge.play(game.id))}>
            {p?.type === "playing" ? "Playing…" : "▶ Play"}
          </button>
          <button className="secondary" onClick={() => run(() => bridge.openFolder(game.id))}>
            Open folder
          </button>
          <button className="ghost" onClick={() => run(() => bridge.uninstall(game.id))}>
            Uninstall
          </button>
        </div>
        <p className="muted small">
          Installed in <code>{installed.dir}</code>
          {p?.type === "stopped" ? ` · last session ${Math.round(p.seconds / 60)} min` : ""}
        </p>
        {error && <p className="error small">{error}</p>}
      </div>
    );
  }

  return (
    <div className="install panel">
      <div className="inline">
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Install location" disabled={busy}>
          {[...new Set([target, ...drives.map((d) => (d.path.endsWith("\\") ? `${d.path}Games` : `${d.path.replace(/\/$/, "")}/Games`))])]
            .filter(Boolean)
            .map((dir) => {
              const d = driveFor(dir);
              return (
                <option key={dir} value={dir}>
                  {dir}
                  {d ? ` (${formatBytes(d.freeBytes)} free)` : ""}
                </option>
              );
            })}
        </select>
        <button className="ghost" disabled={busy} onClick={async () => { const dir = await bridge.chooseFolder(); if (dir) setTarget(dir); }}>
          Choose folder…
        </button>
      </div>
      <div className="inline">
        <button
          ref={button}
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setProgress(null);
              await bridge.setInstallDir(target);
              await bridge.install(game.id, target);
            })
          }
        >
          {busy ? "Installing…" : `Install (${formatBytes(game.sizeBytes)})`}
        </button>
        {busy && (
          <button className="ghost" onClick={() => bridge.cancel(game.id)}>
            Cancel
          </button>
        )}
      </div>
      {lowSpace && <p className="error small">Only {formatBytes(drive!.freeBytes)} free on that drive.</p>}
      {busy && p && (
        <div className="progress">
          <div className="meter">
            <div style={{ width: `${p.type === "extract" ? 100 : pct}%` }} />
            <span>
              {p.type === "download" && `Downloading ${p.index + 1}/${p.count} · ${formatBytes(p.received)} of ${formatBytes(p.total)}`}
              {p.type === "extract" && `Unpacking ${p.archive}`}
              {p.type === "removed" && "Cleaning up archives"}
              {p.type === "start" && "Starting…"}
              {p.type === "downloaded" && "Downloaded"}
            </span>
          </div>
        </div>
      )}
      {p?.type === "cancelled" && <p className="muted small">Cancelled. Installing again resumes where it stopped.</p>}
      {error && p?.type !== "cancelled" && <p className="error small">{error}</p>}
      <p className="muted small">Archives are unpacked and removed automatically once the download finishes.</p>
    </div>
  );
}
