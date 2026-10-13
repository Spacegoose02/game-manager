import { useEffect, useRef, useState } from "react";
import { api, type Integrations } from "../api";

type S = Integrations["settings"];

/** API keys and TinyAuth / OIDC sign-in, editable without touching the container. */
export function AdminIntegrations({ onMessage }: { onMessage: (m: string) => void }) {
  const [view, setView] = useState<Integrations | null>(null);
  const [s, setS] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);

  // Load once, so a parent re-render never replaces what is being typed.
  const report = useRef(onMessage);
  report.current = onMessage;
  useEffect(() => {
    api.integrations().then((v) => {
      setView(v);
      setS(v.settings);
    }, (e: Error) => report.current(e.message));
  }, []);
  if (!s || !view) return null;

  const set = <K extends keyof S>(k: K, patch: S[K] extends object ? Partial<S[K]> : S[K]) =>
    setS({ ...s, [k]: typeof patch === "object" ? { ...(s[k] as object), ...patch } : patch });
  const env = (k: string) => view.fromEnvironment.includes(k);
  const save = async () => {
    const v = await api.saveIntegrations(s);
    setView(v);
    setS(v.settings);
    return v;
  };
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      onMessage(await fn());
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const test = (name: string) => run(async () => (await save(), (await api.testIntegration(name)).message));
  const envNote = (k: string) => (env(k) ? <small className="muted"> Set in the container's environment; values here take priority.</small> : null);
  const origin = location.origin;

  return (
    <section className="panel integrations" id="integrations">
      <h2>Connections and sign-in</h2>

      <h3>Public address</h3>
      <div className="inline">
        <input placeholder={origin} value={s.publicUrl} onChange={(e) => set("publicUrl", e.target.value)} style={{ flex: 1 }} />
        <button type="button" className="secondary" onClick={() => set("publicUrl", origin)}>
          Use this address
        </button>
      </div>
      <p className="muted small">How people reach the server, e.g. https://games.example.com. Needed for single sign-on.{envNote("publicUrl")}</p>

      <h3>Single sign-on (TinyAuth or any OIDC provider)</h3>
      <ol className="steps small muted">
        <li>
          In TinyAuth, add an OIDC client for LootDen with this redirect URL:{" "}
          <code>{view.callbackUrl ?? `${s.publicUrl || origin}/api/auth/oidc/callback`}</code>
        </li>
        <li>Paste TinyAuth's address and the client ID and secret it gives you below.</li>
        <li>Press Save and test. A "Sign in with …" button then appears on the login page.</li>
      </ol>
      <div className="grid-form">
        <label>
          Issuer (TinyAuth's address)
          <input placeholder="https://auth.example.com" value={s.oidc.issuer} onChange={(e) => set("oidc", { issuer: e.target.value })} />
        </label>
        <label>
          Client ID
          <input value={s.oidc.clientId} onChange={(e) => set("oidc", { clientId: e.target.value })} />
        </label>
        <label>
          Client secret
          <input type="password" value={s.oidc.clientSecret} onChange={(e) => set("oidc", { clientSecret: e.target.value })} />
        </label>
        <label>
          Button label
          <input placeholder="TinyAuth" value={s.oidc.name} onChange={(e) => set("oidc", { name: e.target.value })} />
        </label>
        <label>
          Admin group (optional)
          <input placeholder="admins" value={s.oidc.adminGroup} onChange={(e) => set("oidc", { adminGroup: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.oidc.autoCreate} onChange={(e) => set("oidc", { autoCreate: e.target.checked })} />
          Create a profile on first sign-in
        </label>
      </div>
      <button disabled={busy} onClick={() => test("oidc")}>
        Save and test
      </button>
      {envNote("oidc")}

      <h3>Game information and artwork</h3>
      <p className="muted small">All free. Steam and PCGamingWiki always work without keys; these add better matches and artwork.</p>
      <div className="api-row">
        <div>
          <strong>IGDB</strong> <small className="muted">best metadata · Twitch developer app at dev.twitch.tv/console</small>
          {envNote("igdb")}
        </div>
        <input placeholder="Client ID" value={s.igdb.clientId} onChange={(e) => set("igdb", { clientId: e.target.value })} />
        <input type="password" placeholder="Client secret" value={s.igdb.clientSecret} onChange={(e) => set("igdb", { clientSecret: e.target.value })} />
        <button disabled={busy} onClick={() => test("igdb")}>
          Save and test
        </button>
      </div>
      <div className="api-row">
        <div>
          <strong>SteamGridDB</strong> <small className="muted">covers and backgrounds · key at steamgriddb.com, Preferences, API</small>
          {envNote("steamgriddb")}
        </div>
        <input type="password" placeholder="API key" value={s.steamgriddb.apiKey} onChange={(e) => set("steamgriddb", { apiKey: e.target.value })} />
        <button disabled={busy} onClick={() => test("steamgriddb")}>
          Save and test
        </button>
      </div>
      <div className="api-row">
        <div>
          <strong>RAWG</strong> <small className="muted">large catalogue · key at rawg.io/apidocs</small>
          {envNote("rawg")}
        </div>
        <input type="password" placeholder="API key" value={s.rawg.apiKey} onChange={(e) => set("rawg", { apiKey: e.target.value })} />
        <button disabled={busy} onClick={() => test("rawg")}>
          Save and test
        </button>
      </div>
      <p className="muted small">IGDB is throttled to about 3 requests a second, under its limit of 4. After adding keys, use "Match missing" in Metadata above.</p>
    </section>
  );
}
