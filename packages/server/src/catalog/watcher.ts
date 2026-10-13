import { watch, type FSWatcher } from "node:fs";

/**
 * Watches the games folder and triggers a rescan once changes settle, so a game
 * being copied in (which can take many minutes) is picked up after the copy ends.
 * Network and FUSE filesystems (including Unraid user shares) do not always emit
 * events, so the periodic rescan stays on as a safety net.
 */
export class FolderWatcher {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dir: string,
    private readonly onSettled: () => void,
    private readonly settleMs = 15_000,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  start(): boolean {
    try {
      this.watcher = watch(this.dir, { recursive: true }, () => this.bump());
      this.watcher.on("error", (err) => {
        this.log(`Watch error, relying on periodic rescans: ${err.message}`);
        this.stop();
      });
      return true;
    } catch (err) {
      this.log(`Cannot watch ${this.dir}, relying on periodic rescans: ${(err as Error).message}`);
      return false;
    }
  }

  private bump(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onSettled();
    }, this.settleMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
  }
}
