/**
 * A worker-faithful dry run of one site's setupScript on a live page (report
 * fixes 3, item 16b; the developer's 2026-10-21 report, item 2, LRN-SETUP-36).
 *
 * The tool passed between preparation folders counted cookies from
 * request.headers(), which never holds the Cookie header: a script that sent
 * cookies showed "cookieSent: 0", so every "no cookie sent" proof made with it
 * proved nothing. This one:
 *   - counts cookies with request.allHeaders(), on the page's navigations and
 *     on the script's own fetches apart;
 *   - plants a cookie on the listing's host first, so a navigation that
 *     carries no cookie at all shows the count is broken (the run fails);
 *   - aborts every request that is not a GET (read-only on the employer's
 *     side: no form post, no tracking beacon), and every request a failure
 *     filter names, and logs each abort; a failure run that aborted nothing
 *     fails (LRN-SETUP-31: Git Bash once rewrote the filter into a path);
 *   - reads the page with the worker's own code: runSetupScript, the listing
 *     extraction, the location map, the normaliser (with the config-maps-id
 *     rule), the validator, which drops a record with no text, and the id
 *     fallback.
 * It never clicks; a click a setup script makes itself can only issue GETs.
 */
import type { Page } from "playwright";
import { runSetupScript } from "../../worker/lib/setupScriptRun";
import { applyLocationMap, LOCATION_FROM_MAP, readLocationMap } from "../../worker/lib/locationMap";
import { mapsExternalJobId } from "../../worker/lib/fieldMappings";
import { normalizeJobRecord } from "../../worker/lib/normalizer";
import { validateJobRecord } from "../../worker/lib/validator";
import { applyJobIdFallback, jobIdKind } from "../../worker/lib/synthesizeJobId";

/** The probe cookie planted on the listing's host before the first load. */
export const PLANTED_COOKIE = "haide_dryrun_probe";

export interface DryRunOptions {
  listingUrl: string;
  /** Site.fieldMappings as stored (with _meta). */
  fieldMappings: unknown;
  /** The script to run; null runs none (the config's own is passed by the caller). */
  setupScript: string | null;
  /** Abort every request whose URL contains this; a run with one must abort something. */
  failFilter?: string | null;
  /** Tests only: answer a request that passed the filters (default: go to the network). */
  serve?: (route: import("playwright").Route) => Promise<void>;
}

export interface DryRunReport {
  listingUrl: string;
  cookies: {
    planted: string;
    /** Navigations (document requests) that carried a Cookie header, of all of them. */
    navigationsWithCookie: number;
    navigations: number;
    /** The script's and the page's fetch/XHR requests that carried a Cookie header, of all of them. */
    fetchesWithCookie: number;
    fetches: number;
    /** Each fetch/XHR URL that carried a cookie. */
    fetchUrlsWithCookie: string[];
  };
  aborted: Array<{ url: string; method: string; why: "not GET" | "failure filter" }>;
  script: "ran" | "error" | "timeout" | "none";
  records: number;
  valid: number;
  /** Of the valid records: their ids as the worker would store them. */
  ids: Array<{ id: string | null; kind: "native" | "synthesised"; title: string }>;
  verdict: { ok: boolean; problems: string[] };
}

/** What makes a dry run fail, from its counts alone. */
export function dryRunVerdict(r: Pick<DryRunReport, "cookies" | "aborted"> & { failFilter?: string | null }): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (r.cookies.navigations > 0 && r.cookies.navigationsWithCookie === 0) {
    problems.push(`the cookie count does not work: the planted cookie ${r.cookies.planted} was on none of ${r.cookies.navigations} navigation(s)`);
  }
  if (r.failFilter && !r.aborted.some((a) => a.why === "failure filter")) {
    problems.push(`a failure run that aborted nothing: no request matched ${JSON.stringify(r.failFilter)}`);
  }
  return { ok: problems.length === 0, problems };
}

export async function setupScriptDryRun(page: Page, opts: DryRunOptions): Promise<DryRunReport> {
  // The worker's own read; its module builds a database pool it never uses here.
  process.env.DATABASE_URL ??= "postgresql://dryrun:dryrun@127.0.0.1:1/dryrun";
  const { workerListingRead: w } = await import("../../worker/jobs/scrape");

  const origin = new URL(opts.listingUrl).origin;
  await page.context().addCookies([{ name: PLANTED_COOKIE, value: "1", url: `${origin}/` }]);
  // Under tsx the worker's in-page code calls __name (keepNames); the built
  // worker does not. Given as a string, so tsx leaves it alone.
  await page.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");

  const aborted: DryRunReport["aborted"] = [];
  const abortedRequests = new Set<import("playwright").Request>();
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() !== "GET") {
      aborted.push({ url: req.url(), method: req.method(), why: "not GET" });
      abortedRequests.add(req);
      return route.abort();
    }
    if (opts.failFilter && req.url().includes(opts.failFilter)) {
      aborted.push({ url: req.url(), method: req.method(), why: "failure filter" });
      abortedRequests.add(req);
      return route.abort();
    }
    return opts.serve ? opts.serve(route) : route.continue();
  });

  // Every navigation and fetch the page made; counted at the end, the aborted
  // ones aside (they were never sent).
  const requests: Array<import("playwright").Request> = [];
  page.on("request", (req) => {
    const type = req.resourceType();
    if (type === "document" || type === "fetch" || type === "xhr") requests.push(req);
  });

  const fieldMappings = w.parseFieldMappings(opts.fieldMappings);
  const { listingSelector, itemSelector, revealSelector } = w.getStructuralSelectors(opts.fieldMappings);
  await page.goto(opts.listingUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (itemSelector) await page.waitForSelector(itemSelector, { timeout: 15_000 }).catch(() => {});

  const script = opts.setupScript ? await runSetupScript(page, opts.setupScript) : "none";
  const raws = await w.extractRawFieldsFromListingPageOnce(page, fieldMappings, listingSelector, itemSelector, revealSelector, null);

  // allHeaders() holds what the browser really sent, the Cookie header included.
  const cookies: DryRunReport["cookies"] = {
    planted: PLANTED_COOKIE,
    navigationsWithCookie: 0,
    navigations: 0,
    fetchesWithCookie: 0,
    fetches: 0,
    fetchUrlsWithCookie: [],
  };
  for (const req of requests) {
    if (abortedRequests.has(req)) continue;
    const headers = await req.allHeaders().catch(() => ({}) as Record<string, string>);
    const sent = !!headers["cookie"];
    if (req.resourceType() === "document") {
      cookies.navigations++;
      if (sent) cookies.navigationsWithCookie++;
    } else {
      cookies.fetches++;
      if (sent) {
        cookies.fetchesWithCookie++;
        cookies.fetchUrlsWithCookie.push(req.url());
      }
    }
  }

  // The worker's normalise -> validate -> id fallback, as executeScrape runs it.
  const locationMap = readLocationMap(opts.fieldMappings);
  const configMapsId = mapsExternalJobId(opts.fieldMappings) || raws.some((r) => (r["externalJobId"] ?? "").trim() !== "");
  const valid = raws
    .map((raw) => {
      let rawFields = raw;
      if (locationMap) rawFields = { ...raw, location: applyLocationMap(raw["location"], locationMap).value, [LOCATION_FROM_MAP]: "1" };
      const normalized = normalizeJobRecord(rawFields, { configMapsId });
      return { normalized, validation: validateJobRecord(normalized) };
    })
    .filter((r) => r.validation.isValid);
  const fallback = applyJobIdFallback(
    valid.map(({ normalized: n }) => ({ externalJobId: n.externalJobId, title: n.title, department: n.department, url: n.url })),
  );

  const partial = { cookies, aborted, failFilter: opts.failFilter ?? null };
  return {
    listingUrl: opts.listingUrl,
    cookies,
    aborted,
    script,
    records: raws.length,
    valid: valid.length,
    ids: valid.map(({ normalized: n }, i) => ({ id: fallback.ids[i] ?? null, kind: jobIdKind(fallback.ids[i]), title: n.title })),
    verdict: dryRunVerdict(partial),
  };
}
