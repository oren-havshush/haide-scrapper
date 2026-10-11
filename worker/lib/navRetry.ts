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
//
// A 5xx answer gets the same single retry (owner, 2026-10-11): razel.co.il's
// listing answered HTTP 503 from IIS at 00:26Z and 200 with every card at
// 09:29Z. `retryResult` names a result worth one more try; the second answer is
// what the run gets, whatever it is (hostError.test.ts).

import { detectChallengeResponse } from "./zeroMatch";

export const LISTING_RETRY_WAIT_MS = 15_000;
export const LISTING_RETRY_TIMEOUT_MS = 60_000;

/** Playwright's navigation timeout: a TimeoutError, or its "Timeout Nms exceeded" message. */
export function isNavigationTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(err.message);
}

/**
 * A navigation answer of 5xx, named for the log ("HTTP 503"); null for anything
 * else. A 5xx that is a host's bot challenge (Cloudflare has served its
 * interstitial as 503) is not retried: it is labelled blocked, as before.
 */
export function serverErrorRetry(
  r: { status: () => number; url?: () => string; headers?: () => Record<string, string> } | null | undefined,
): string | null {
  if (!r) return null;
  const status = r.status();
  if (!(status >= 500 && status <= 599)) return null;
  if (detectChallengeResponse(r.url?.() ?? "", r.headers?.() ?? {}) !== null) return null;
  return `HTTP ${status}`;
}

export async function navigateWithRetry<T>(
  go: (timeoutMs: number) => Promise<T>,
  opts: {
    firstTimeoutMs: number;
    retryTimeoutMs?: number;
    waitMs?: number;
    sleep?: (ms: number) => Promise<void>;
    log?: (msg: string) => void;
    /** A result worth one more try, named for the log; null to keep it. */
    retryResult?: (result: T) => string | null;
  },
): Promise<T> {
  const waitMs = opts.waitMs ?? LISTING_RETRY_WAIT_MS;
  const retryTimeoutMs = opts.retryTimeoutMs ?? LISTING_RETRY_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let first: T;
  try {
    first = await go(opts.firstTimeoutMs);
  } catch (err) {
    if (!isNavigationTimeout(err)) throw err;
    opts.log?.(
      `[scrape] listing navigation timed out after ${opts.firstTimeoutMs} ms; ` +
        `retrying once in ${waitMs} ms with a ${retryTimeoutMs} ms limit`,
    );
    await sleep(waitMs);
    return await go(retryTimeoutMs);
  }
  const why = opts.retryResult?.(first) ?? null;
  if (why === null) return first;
  opts.log?.(`[scrape] listing navigation answered ${why}; retrying once in ${waitMs} ms with a ${retryTimeoutMs} ms limit`);
  await sleep(waitMs);
  return await go(retryTimeoutMs);
}
