export interface ActiveDownload {
  client: "qbittorrent" | "sabnzbd";
  /** Torrent hash or SABnzbd nzo id. */
  id: string;
  name: string;
  sizeBytes: number;
  progress: number; // 0..1
  downloadSpeed: number; // bytes/s
  etaSeconds: number | null;
  state: "downloading" | "paused" | "queued" | "completed" | "seeding" | "failed" | "checking";
  /** Where the client put the files (in the client's own path space). */
  path: string | null;
}

export interface DownloadClient {
  readonly name: ActiveDownload["client"];
  readonly configured: boolean;
  test(): Promise<string>;
  add(url: string, name?: string): Promise<string | null>;
  list(): Promise<ActiveDownload[]>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  remove(id: string, deleteFiles: boolean): Promise<void>;
}
