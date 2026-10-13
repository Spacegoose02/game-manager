import { useState } from "react";
import { PLATFORMS } from "@lootden/shared";
import { formatBytes, type SearchResult } from "../api";

/**
 * Prowlarr search results with a Get button per release. "Send to" picks where the finished
 * download goes: the PC library, or a console's folder on the Emulation shelf.
 */
export function DownloadResults({ results, onGrab, busy }: { results: SearchResult[]; onGrab: (r: SearchResult, platform: string | null) => void; busy: boolean }) {
  const [platform, setPlatform] = useState("pc");
  const [showBlocked, setShowBlocked] = useState(false);
  const blocked = results.filter((r) => r.allowed === false).length;
  const shown = results.filter((r) => showBlocked || r.allowed !== false);
  return results.length === 0 ? (
    <p className="muted">Nothing found.</p>
  ) : (
    <>
      <label className="inline small send-to">
        Send to
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === "pc" ? "PC games" : `Emulation: ${p.name}`}
            </option>
          ))}
        </select>
      </label>
      {blocked > 0 && (
        <label className="check small send-to">
          <input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} />
          Show {blocked} hidden by your release rules
        </label>
      )}
      {shown.length === 0 && <p className="muted">Everything found breaks a release rule.</p>}
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Indexer</th>
                  <th className="num">Size</th>
                  <th className="num">Seeds</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 100).map((r) => (
                  <tr key={r.guid} className={r.allowed === false ? "blocked" : r.best ? "best" : ""}>
                    <td>
                      {r.infoUrl ? (
                        <a href={r.infoUrl} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                      ) : (
                        r.title
                      )}
                      {r.best && <span className="badge small best-badge">Best match</span>}
                      <br />
                      <small className="muted">
                        {r.protocol}
                        {r.publishedAt ? ` · ${new Date(r.publishedAt).toLocaleDateString()}` : ""}
                      </small>
                      {r.allowed === false && r.reason && <small className="error"> · {r.reason}</small>}
                    </td>
                    <td>{r.indexer}</td>
                    <td className="num">{formatBytes(r.sizeBytes)}</td>
                    <td className="num">{r.protocol === "torrent" ? (r.seeders ?? "?") : "—"}</td>
                    <td className="num">
                      <button disabled={busy} onClick={() => onGrab(r, platform === "pc" ? null : platform)}>
                        Get
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
    </>
  );
}
