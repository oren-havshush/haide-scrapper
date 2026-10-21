/**
 * How a company-profile run behaves, kept pure so it can be tested (report
 * fixes 3, item 13; the developer's 2026-10-19 to 20 report, items 3 and 8).
 *
 *   - The language model runs only when --llm is passed, on the dry run and
 *     the real run alike. It used to run unless --no-llm was passed, and the
 *     dry run checked before a capture ran with --no-llm, so a real run wrote
 *     model values the dry run never showed (dsit.co.il's address).
 *   - --probe takes a user agent (--probe-ua), and when the identity it used
 *     is refused (401, 403, 429, 503, a challenge or "Request Rejected" page)
 *     it tries once more as desktop Chrome (fnx.co.il, midrag.co.il behind
 *     CloudFront; as-invest.co.il's "Request Rejected").
 *   - A logo fetch that failed in transit is tried once more (gal-hr.co.il's
 *     "fetch failed" on a logo the dry run had read minutes before). A logo
 *     the gate rejected is an answer and is not retried.
 */

/** The desktop Chrome identity, as the worker's hold probe sends it. */
export const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** True when the run asked for the model: --llm, and not --no-llm. */
export function llmRequested(argv: readonly string[]): boolean {
  return argv.includes("--llm") && !argv.includes("--no-llm");
}

/** What a page load said, for the refusal test. */
export type NavNote = { status?: number; title?: string; bodyText?: string };

const REFUSAL_STATUS = new Set([401, 403, 429, 503]);
const REFUSAL_PAGE = /^\s*(request rejected|access denied|forbidden|just a moment|attention required|הגישה נדחתה)/i;

/** True when the identity was refused: an HTTP refusal, or a refusal page served with 200. */
export function isRefusedNav(nav: NavNote | null | undefined): boolean {
  if (!nav) return false;
  if (typeof nav.status === "number" && REFUSAL_STATUS.has(nav.status)) return true;
  return REFUSAL_PAGE.test(nav.title ?? "") || REFUSAL_PAGE.test((nav.bodyText ?? "").slice(0, 200));
}

/**
 * Run the probe with the given identity (none: the browser's default), and
 * once more as desktop Chrome when that identity was refused. Returns the
 * result kept and the identity that produced it.
 */
export async function probeWithIdentityRetry<R>(
  run: (userAgent: string | undefined) => Promise<R>,
  refused: (result: R) => boolean,
  userAgent?: string,
): Promise<{ result: R; userAgent: string | undefined; retried: boolean }> {
  const first = await run(userAgent);
  if (!refused(first) || userAgent === DESKTOP_CHROME_UA) return { result: first, userAgent, retried: false };
  const second = await run(DESKTOP_CHROME_UA);
  return { result: second, userAgent: DESKTOP_CHROME_UA, retried: true };
}

/** Call `fn`; when it throws an error `transient` accepts, call it once more. */
export async function retryOnce<T>(fn: () => Promise<T>, transient: (error: unknown) => boolean): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!transient(error)) throw error;
    return await fn();
  }
}
