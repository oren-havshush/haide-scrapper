// The listing-navigation retry (owner, 2026-10-05). Pure, so the rule is tested
// without a browser (navRetry.test.ts); scrape.ts's gotoForgiving calls it for
// the listing loads only.
//
// b-e and one1 failed on four nights between them, each time on the FIRST
// page.goto to the listing, which hit its 30-second limit ~35 s into the run;
// both load in ~3 s by day and scrape in 35-115 s on a good night. So a listing
// navigation that times out waits ~15 s and tries once more with a 60 s limit.
// A second timeout is thrown as it is today (category timeout). Any other error
// is thrown at once. Detail pages and pagination do not use this.

export const LISTING_RETRY_WAIT_MS = 15_000;
export const LISTING_RETRY_TIMEOUT_MS = 60_000;

/** Playwright's navigation timeout: a TimeoutError, or its "Timeout Nms exceeded" message. */
export function isNavigationTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(err.message);
}

export async function navigateWithRetry<T>(
  go: (timeoutMs: number) => Promise<T>,
  opts: {
    firstTimeoutMs: number;
    retryTimeoutMs?: number;
    waitMs?: number;
    sleep?: (ms: number) => Promise<void>;
    log?: (msg: string) => void;
  },
): Promise<T> {
  try {
    return await go(opts.firstTimeoutMs);
  } catch (err) {
    if (!isNavigationTimeout(err)) throw err;
    const waitMs = opts.waitMs ?? LISTING_RETRY_WAIT_MS;
    const retryTimeoutMs = opts.retryTimeoutMs ?? LISTING_RETRY_TIMEOUT_MS;
    opts.log?.(
      `[scrape] listing navigation timed out after ${opts.firstTimeoutMs} ms; ` +
        `retrying once in ${waitMs} ms with a ${retryTimeoutMs} ms limit`,
    );
    await (opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(waitMs);
    return await go(retryTimeoutMs);
  }
}
