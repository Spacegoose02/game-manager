import { useEffect, useRef, useState } from "react";
import { api, formatBytes, type ClientFile } from "../api";

/** Admin side of the Get the app page: upload builds, or pull the latest GitHub release. */
export function AdminApps({ onMessage }: { onMessage: (m: string) => void }) {
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [repo, setRepo] = useState(() => {
    try {
      return localStorage.getItem("gm-release-repo") ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const load = () => api.clients().then(setFiles, (e: Error) => onMessage(e.message));
  useEffect(() => {
    void load();
  }, []);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    try {
      onMessage(await fn());
      await load();
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="panel" id="apps">
      <h2>App downloads</h2>
      <p className="muted small">
        Files here show on the <a href="/apps">Get the app</a> page for everyone. They live in <code>/data/clients</code>, so you can also copy them
        there directly.
      </p>
      <div className="inline">
        <input placeholder="GitHub repository, e.g. you/lootden" value={repo} onChange={(e) => setRepo(e.target.value)} style={{ flex: 1 }} />
        <button
          disabled={!!busy || !repo.trim()}
          onClick={() =>
            run("github", async () => {
              try {
                localStorage.setItem("gm-release-repo", repo.trim());
              } catch {
                // not remembered
              }
              const r = await api.fetchRelease(repo.trim());
              return `Fetched ${r.files.length} files from ${r.tag}`;
            })
          }
        >
          {busy === "github" ? "Fetching…" : "Get latest release"}
        </button>
        <button className="secondary" disabled={!!busy} onClick={() => input.current?.click()}>
          {busy === "upload" ? "Uploading…" : "Upload files"}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = "";
            if (picked.length)
              void run("upload", async () => {
                for (const f of picked) await api.uploadClient(f);
                return `Uploaded ${picked.length} file${picked.length > 1 ? "s" : ""}`;
              });
          }}
        />
      </div>
      <ul className="list">
        {files.map((f) => (
          <li key={f.name}>
            <span>
              {f.name} <small className="muted">({f.kind}, {formatBytes(f.size)})</small>
            </span>
            <button className="ghost" disabled={!!busy} onClick={() => confirm(`Remove ${f.name}?`) && run("rm", async () => (await api.deleteClient(f.name), `Removed ${f.name}`))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
