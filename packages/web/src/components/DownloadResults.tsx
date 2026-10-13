import { useState } from "react";
import { PLATFORMS } from "@lootden/shared";
import { formatBytes, type SearchResult } from "../api";

/**
 * Prowlarr search results with a Get button per release. "Send to" picks where the finished
 * download goes: the PC library, or a console's folder on the Emulation shelf.
 */
export function DownloadResults({ results, onGrab, busy }: { results: SearchResult[]; onGrab: (r: SearchResult, platform: string | null) => void; busy: boolean }) {
  const [platform, setPlatform] = useState("pc");
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
                {results.slice(0, 100).map((r) => (
                  <tr key={r.guid}>
                    <td>
                      {r.infoUrl ? (
                        <a href={r.infoUrl} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                      ) : (
                        r.title
                      )}
                      <br />
                      <small className="muted">
                        {r.protocol}
                        {r.publishedAt ? ` · ${new Date(r.publishedAt).toLocaleDateString()}` : ""}
                      </small>
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
