/**
 * setupScriptRun.ts — running a site's setupScript, and hearing what it says.
 *
 * Lifted out of worker/jobs/scrape.ts so it can be driven against a real
 * Chromium page in a test. The script is per-site JavaScript written by hand
 * during onboarding; it is the part of a config most likely to be wrong, and
 * the part whose being wrong is hardest to see (LRN-SETUP-19).
 */

import type { ConsoleMessage, Page } from "playwright";

/** Long-running scripts (load-more loops with sleeps) need more than the 30s default. */
const SETUP_SCRIPT_TIMEOUT_MS = 90_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * How many console lines one setup-script phase may contribute.
 *
 * A script with a runaway loop can emit thousands, and this runs once per
 * listing page per site, 145 sites a night, into a journal an operator has to
 * read in the morning. Enough to diagnose, not enough to bury.
 */
export const SETUP_CONSOLE_LIMIT = 20;

/** The levels worth an operator's attention. `log` and `info` are the site's own chatter. */
const NOISY_LEVELS = new Set(["warning", "error"]);

export async function runSetupScript(page: Page, script: string): Promise<void> {
  // What the page says WHILE the script runs. Captured unconditionally: the
  // failure this exists for (LRN-SETUP-19) looked like a completely successful
  // run, so a diagnostic that only fires on a bad-looking run cannot see it.
  const noise: string[] = [];
  const note = (line: string) => {
    if (noise.length < SETUP_CONSOLE_LIMIT) noise.push(line.slice(0, 300));
  };
  const onConsole = (msg: ConsoleMessage) => {
    if (NOISY_LEVELS.has(msg.type())) note(`${msg.type()}: ${msg.text()}`);
  };
  const onPageError = (err: Error) => note(`pageerror: ${err.message}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    // Run the script body inside an async function and AWAIT it, so scripts
    // that perform `await fetch(...)` enrichments (e.g. Workday per-item job
    // description JSON) fully resolve before extraction. Plain synchronous
    // scripts (sync XHR injection, DOM pokes) keep working — the async wrapper
    // just resolves immediately.
    page.setDefaultTimeout(SETUP_SCRIPT_TIMEOUT_MS);
    try {
      await page.evaluate(async (src: string) => {
        const AsyncFunction = Object.getPrototypeOf(
          async function () {},
        ).constructor as new (body: string) => () => Promise<unknown>;
        const fn = new AsyncFunction(src);
        await fn();
      }, script);
    } finally {
      // Restore even when the script throws. A site whose jobs span several
      // listing pages runs this once per page, and a raised default left behind
      // by the first would triple every later page's worst case — straight into
      // the run's own 15-minute cap.
      page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    }
    await page.waitForTimeout(1_500);
    console.info(`[scrape] setupScript executed (${script.length} chars)`);
  } catch (e) {
    console.warn(`[scrape] setupScript error — ${(e as Error).message}`);
  } finally {
    // Detached here, not at the end of the scrape: a site with several listing
    // pages runs this once per page, and a listener left attached would report
    // page two's output as page one's as well.
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    if (noise.length > 0) {
      console.warn(
        `[scrape] setupScript console (${noise.length}` +
          `${noise.length >= SETUP_CONSOLE_LIMIT ? "+, truncated" : ""}):`,
        noise,
      );
    }
  }
}
