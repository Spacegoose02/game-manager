import { json, type Db } from "../db/database.js";

export interface ConnectorSettings {
  qbittorrent: { url: string; username: string; password: string; category: string; savePath: string };
  sabnzbd: { url: string; apiKey: string; category: string };
  prowlarr: { url: string; apiKey: string; categories: number[] };
  import: {
    /** copy keeps torrents seeding; move frees the space (best for usenet); off leaves files alone. */
    mode: "copy" | "move" | "off";
    /** How paths reported by the download clients map to paths inside this container. */
    pathMappings: Array<{ from: string; to: string }>;
  };
}

export const DEFAULT_CONNECTORS: ConnectorSettings = {
  qbittorrent: { url: "", username: "", password: "", category: "games", savePath: "" },
  sabnzbd: { url: "", apiKey: "", category: "games" },
  // 4000 = PC games in the Newznab/Torznab category tree that Prowlarr uses.
  prowlarr: { url: "", apiKey: "", categories: [4000] },
  import: { mode: "copy", pathMappings: [] },
};

const KEY = "connectors";
const SECRET = "********";

export function loadConnectorSettings(db: Db): ConnectorSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  const stored = json<Partial<ConnectorSettings>>(row?.value, {});
  return {
    qbittorrent: { ...DEFAULT_CONNECTORS.qbittorrent, ...stored.qbittorrent },
    sabnzbd: { ...DEFAULT_CONNECTORS.sabnzbd, ...stored.sabnzbd },
    prowlarr: { ...DEFAULT_CONNECTORS.prowlarr, ...stored.prowlarr },
    import: { ...DEFAULT_CONNECTORS.import, ...stored.import },
  };
}

/** Saves settings; a secret sent back as the mask keeps its stored value. */
export function saveConnectorSettings(db: Db, incoming: Partial<ConnectorSettings>): ConnectorSettings {
  const current = loadConnectorSettings(db);
  const merged: ConnectorSettings = {
    qbittorrent: { ...current.qbittorrent, ...incoming.qbittorrent },
    sabnzbd: { ...current.sabnzbd, ...incoming.sabnzbd },
    prowlarr: { ...current.prowlarr, ...incoming.prowlarr },
    import: { ...current.import, ...incoming.import },
  };
  if (merged.qbittorrent.password === SECRET) merged.qbittorrent.password = current.qbittorrent.password;
  if (merged.sabnzbd.apiKey === SECRET) merged.sabnzbd.apiKey = current.sabnzbd.apiKey;
  if (merged.prowlarr.apiKey === SECRET) merged.prowlarr.apiKey = current.prowlarr.apiKey;
  for (const k of ["qbittorrent", "sabnzbd", "prowlarr"] as const) merged[k].url = merged[k].url.trim().replace(/\/+$/, "");
  if (!["copy", "move", "off"].includes(merged.import.mode)) throw new Error("Unknown import mode; use copy, move or off");
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(merged));
  return merged;
}

/** Settings as shown to the admin UI, with secrets masked. */
export function maskedConnectorSettings(s: ConnectorSettings): ConnectorSettings {
  return {
    ...s,
    qbittorrent: { ...s.qbittorrent, password: s.qbittorrent.password ? SECRET : "" },
    sabnzbd: { ...s.sabnzbd, apiKey: s.sabnzbd.apiKey ? SECRET : "" },
    prowlarr: { ...s.prowlarr, apiKey: s.prowlarr.apiKey ? SECRET : "" },
  };
}
