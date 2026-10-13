export type FetchLike = typeof fetch;

/** Spaces requests to one host and backs off when the host says "too many requests". */
export class RateLimiter {
  private chain: Promise<unknown> = Promise.resolve();
  private next = 0;

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.next - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.next = Date.now() + this.minIntervalMs;
      return task();
    });
    this.chain = run.catch(() => {});
    return run;
  }

  /** Pushes the next slot out, e.g. after a 429. */
  pause(ms: number): void {
    this.next = Math.max(this.next, Date.now() + ms);
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** fetch with a timeout, JSON parsing and up to three retries on 429/5xx through the limiter. */
export async function limitedJson<T>(
  limiter: RateLimiter,
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await limiter.schedule(() => fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }));
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
      limiter.pause(retryAfter * 1000);
      continue;
    }
    if (!res.ok) throw new HttpError(`${new URL(url).host} answered ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
    return (await res.json()) as T;
  }
}
