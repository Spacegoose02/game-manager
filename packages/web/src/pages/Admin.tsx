import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { GameSummary, LibraryStats, User } from "@lootden/shared";
import { api, avatarUrl, formatBytes } from "../api";
import { AdminApps } from "../components/AdminApps";
import { AdminIntegrations } from "../components/AdminIntegrations";
import { AdminVideos } from "../components/AdminVideos";

type MetaStatus = Awaited<ReturnType<typeof api.metadataStatus>>;

export function Admin() {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [meta, setMeta] = useState<MetaStatus | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [unmatched, setUnmatched] = useState<GameSummary[]>([]);
  const [feeds, setFeeds] = useState<Array<{ id: string; url: string; title: string }>>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", kidMode: false, role: "user" });
  const [feedUrl, setFeedUrl] = useState("");

  const load = () => {
    api.stats().then(setStats, () => {});
    api.metadataStatus().then(setMeta, () => {});
    api.users().then(setUsers, () => {});
    api.games({ missingMetadata: true }).then(setUnmatched, () => {});
    api.feeds().then(setFeeds, () => {});
  };
  useEffect(load, []);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      setMsg(done);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const used = stats?.disk ? stats.disk.totalBytes - stats.disk.freeBytes : 0;
  return (
    <div className="admin">
      <h1>Admin</h1>
      {msg && <p className="notice">{msg}</p>}

      <section className="panel">
        <h2>Library</h2>
        {stats && (
          <>
            <p>
              {stats.gameCount} games, {formatBytes(stats.totalBytes)}. Last scan {stats.lastScanAt ? new Date(stats.lastScanAt).toLocaleString() : "never"}.
            </p>
            {stats.disk && (
              <div className="meter" title={`${formatBytes(stats.disk.freeBytes)} free`}>
                <div style={{ width: `${(used / stats.disk.totalBytes) * 100}%` }} />
                <span>
                  {formatBytes(stats.disk.freeBytes)} free of {formatBytes(stats.disk.totalBytes)}
                </span>
              </div>
            )}
          </>
        )}
        <button disabled={busy} onClick={() => act(api.rescan, "Library rescanned")}>
          Rescan now
        </button>
      </section>

      <section className="panel">
        <h2>Metadata</h2>
        {meta && (
          <p>
            Sources: {meta.providers.join(", ") || "none"}. {meta.matched} matched, {meta.unmatched} without metadata
            {meta.running ? `, ${meta.queued} in the queue` : ""}.
          </p>
        )}
        {meta && !meta.providers.includes("igdb") && (
          <p className="muted small">Set GM_IGDB_CLIENT_ID and GM_IGDB_CLIENT_SECRET for IGDB covers, age ratings and better matches. The Steam store is used meanwhile.</p>
        )}
        <div className="inline">
          <button disabled={busy} onClick={() => act(() => api.refreshMetadata(false), "Looking up new games")}>
            Look up new games
          </button>
          <button className="secondary" disabled={busy} onClick={() => act(() => api.refreshMetadata(true), "Retrying every unmatched game")}>
            Retry unmatched
          </button>
        </div>
        {unmatched.length > 0 && (
          <>
            <h3>Needs a match</h3>
            <ul className="list">
              {unmatched.slice(0, 50).map((g) => (
                <li key={g.id}>
                  <Link to={`/games/${g.id}`}>{g.title}</Link>
                  <small className="muted">{g.source}</small>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <AdminIntegrations onMessage={setMsg} />
      <AdminApps onMessage={setMsg} />

      <section className="panel">
        <h2>Profiles</h2>
        <ul className="list users">
          {users.map((u) => (
            <li key={u.id}>
              <span className="inline">
                <img src={avatarUrl(u.avatar)} alt="" width={32} height={32} className="avatar" />
                {u.displayName} <small className="muted">@{u.username}</small>
              </span>
              <span className="inline">
                <label className="check">
                  <input type="checkbox" checked={u.kidMode} onChange={(e) => act(() => api.updateUser(u.id, { kidMode: e.target.checked }), "Saved")} />
                  Kid
                </label>
                <select value={u.role} onChange={(e) => act(() => api.updateUser(u.id, { role: e.target.value }), "Saved")} aria-label="Role">
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="ghost" onClick={() => confirm(`Delete ${u.username}?`) && act(() => api.deleteUser(u.id), "Deleted")}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.createUser({ ...newUser, password: newUser.password || undefined });
              setNewUser({ username: "", password: "", kidMode: false, role: "user" });
            }, "Profile created");
          }}
        >
          <input placeholder="Username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} required />
          <input type="password" placeholder="Password (blank for SSO only)" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
          <label className="check">
            <input type="checkbox" checked={newUser.kidMode} onChange={(e) => setNewUser({ ...newUser, kidMode: e.target.checked })} />
            Kid profile
          </label>
          <button disabled={busy}>Add profile</button>
        </form>
      </section>

      <section className="panel">
        <h2>News feeds</h2>
        <ul className="list">
          {feeds.map((f) => (
            <li key={f.id}>
              <span>
                {f.title} <small className="muted">{f.url}</small>
              </span>
              <button className="ghost" onClick={() => act(() => api.removeFeed(f.id), "Feed removed")}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.addFeed(feedUrl);
              setFeedUrl("");
            }, "Feed added");
          }}
        >
          <input type="url" placeholder="https://example.com/feed.xml" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} required />
          <button disabled={busy}>Add feed</button>
        </form>
      </section>
      <AdminVideos onMessage={setMsg} />
    </div>
  );
}
