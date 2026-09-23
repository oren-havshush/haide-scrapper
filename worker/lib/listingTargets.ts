/**
 * listingTargets.ts — several listing pages of ONE employer, scraped into one Site.
 *
 * Why this exists: a company's careers site often splits its jobs across
 * department pages (renuar.co.il: a hub linking stores / head office /
 * logistics). Company identity lives on `Site` — there is no Company model, a
 * Job knows only its siteId, the logo is `/logos/<siteId>.png` — so one Site
 * per page publishes one *employer* per page on the public jobs site, which
 * reads this database directly. `_meta.listingUrls` lets one Site scrape every
 * page and attach every job to itself.
 *
 * Everything decision-shaped is here, dependency-free, so it can be tested
 * without Playwright or Prisma (the pattern of scheduledRun.ts). scrape.ts
 * owns the browser and calls in.
 *
 * Contract:
 *   - A non-empty list is the COMPLETE target set. `siteUrl` is then a label
 *     (the company's careers page) and is scraped only if listed. Unset means
 *     `[siteUrl]` — byte-identical behaviour for every existing site.
 *   - Every target's items are merged BEFORE the single delete+insert that
 *     persistence does per site. Persisting per URL would let one failing
 *     page wipe the others' jobs.
 *   - A page that errors, a page that goes dark (had rows, now yields none),
 *     and a page that was dropped from the config all REFUSE to publish rather
 *     than publish a shrunken set. "A wrong value is worse than a missing one"
 *     applies to a missing department. Nothing is deleted on a refusal.
 *   - Previous per-page counts come from the `_listingUrl` tag each raw record
 *     carries into `Job.rawData` — no schema change.
 */

export type ListingTarget = { url: string };

/** Raw-record key carrying the listing page an item came from. Survives into Job.rawData. */
export const LISTING_URL_TAG = "_listingUrl";

/** Some configured pages errored; the rest were fine. Nothing written. */
export const LISTING_URL_FAILED = "listing_url_failed";
/** A configured page loaded but yielded nothing (or a fraction) where it had rows. Nothing written. */
export const LISTING_URL_EMPTY = "listing_url_empty";
/** The site holds rows from a page that is no longer configured. Scheduled runs refuse. */
export const LISTING_URLS_REMOVED = "listing_urls_removed";

/** COMPLETED + one of these is a soft failure: per-site, never infrastructure, never a delete. */
export const LISTING_SOFT_CATEGORIES = [
  LISTING_URL_FAILED,
  LISTING_URL_EMPTY,
  LISTING_URLS_REMOVED,
] as const;

/** The error recorded for a target the run had no time budget left to visit. */
export const BUDGET_EXHAUSTED = "budget_exhausted";

/** Time to keep in hand before SCRAPE_TIMEOUT_MS so the outer timer never fires mid-list. */
export const DEFAULT_LISTING_BUDGET_RESERVE_MS = 120_000;

/**
 * Per-page version of the undersize guard (scheduledRun.ts). `minPrevious` is
 * lower than the site-level 10 because a department page is small: an 8-job
 * head-office page going dark must trip it.
 */
export type ListingDropThresholds = { minPrevious: number; keepRatio: number };
export const DEFAULT_LISTING_DROP_THRESHOLDS: ListingDropThresholds = {
  minPrevious: 5,
  keepRatio: 0.5,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** http(s) only, canonicalised (`new URL().href`), or null for anything else. */
export function canonicalListingUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * `_meta.listingUrls`, read the way getPaginationConfig reads `_meta.pagination`:
 * tolerant of junk. Strings only, trimmed, canonicalised, deduped, order kept.
 */
export function getListingUrls(fieldMappingsRaw: unknown): ListingTarget[] {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") return [];
  const meta = (fieldMappingsRaw as Record<string, unknown>)["_meta"];
  if (!meta || typeof meta !== "object") return [];
  const raw = (meta as Record<string, unknown>)["listingUrls"];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ListingTarget[] = [];
  for (const entry of raw) {
    const url = canonicalListingUrl(entry);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url });
  }
  return out;
}

/** Non-empty list REPLACES siteUrl; otherwise the one page every site has. Never empty. */
export function resolveListingTargets(input: {
  siteUrl: string;
  listingUrls: readonly ListingTarget[];
}): ListingTarget[] {
  return input.listingUrls.length > 0
    ? input.listingUrls.map((t) => ({ url: t.url }))
    : [{ url: input.siteUrl }];
}

/** True once the run can no longer afford another page without risking the outer timeout. */
export function listingBudgetExhausted(
  startedAtMs: number,
  nowMs: number,
  timeoutMs: number,
  reserveMs: number = DEFAULT_LISTING_BUDGET_RESERVE_MS,
): boolean {
  return nowMs - startedAtMs > timeoutMs - reserveMs;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** What one target produced. `error` is null on success. */
export type ListingUrlResult = {
  url: string;
  items: Record<string, string>[];
  /** Cards the expanded listing showed; null when it could not be counted. */
  seen: number | null;
  error: string | null;
};

export type MergedListing = {
  /** Concatenated in target order, NOT deduped — the caller dedupes once across pages. */
  items: Record<string, string>[];
  /** Sum of the non-null per-target counts; null when none could be counted. */
  listingItemsSeen: number | null;
  failedUrls: Array<{ url: string; error: string }>;
};

export function mergeListingResults(perUrl: readonly ListingUrlResult[]): MergedListing {
  const items: Record<string, string>[] = [];
  let seen: number | null = null;
  const failedUrls: Array<{ url: string; error: string }> = [];
  for (const r of perUrl) {
    if (r.error !== null) {
      failedUrls.push({ url: r.url, error: r.error });
      continue;
    }
    items.push(...r.items);
    if (r.seen !== null) seen = (seen ?? 0) + r.seen;
  }
  return { items, listingItemsSeen: seen, failedUrls };
}

/**
 * Rows the site holds now, counted by the page they came from.
 *
 * Takes the grouped rows as the database returns them (`url` NULL for a row
 * with no tag, `n` a bigint from COUNT). Rows written before this feature carry
 * no tag and land under "" — never treated as belonging to a page, so the first
 * multi-page run of an existing site raises no false "removed" or "dark".
 */
export function previousCountsByUrl(
  rows: ReadonlyArray<{ url: string | null; n: bigint | number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = typeof row.url === "string" ? row.url : "";
    out.set(key, (out.get(key) ?? 0) + Number(row.n));
  }
  return out;
}

/**
 * Items that survived the cross-page RAW dedup, counted by page.
 *
 * Not the count written: validation and the normalized dedup run after the
 * outcome is decided, so `per_url_counts` reports what each page contributed
 * to the merged set, and can sit slightly above what lands in the database.
 */
export function savedCountsByUrl(
  rows: ReadonlyArray<Record<string, string>>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const tag = row[LISTING_URL_TAG] ?? "";
    out.set(tag, (out.get(tag) ?? 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type ListingOutcome =
  /** Write the merged set. `warnings` ride on the run. */
  | { kind: "persist"; warnings: string[] }
  /** Every target failed: throw, so today's categorizeError → FAILED path runs unchanged. */
  | { kind: "rethrow"; error: string }
  /** COMPLETED + category, nothing deleted, nothing written, warnings written by the caller. */
  | {
      kind: "soft_fail";
      failureCategory: (typeof LISTING_SOFT_CATEGORIES)[number];
      error: string;
      warnings: string[];
    };

export type ListingDecisionInput = {
  perUrl: readonly ListingUrlResult[];
  targets: readonly ListingTarget[];
  /** From previousCountsByUrl on the site's current rows. */
  previous: ReadonlyMap<string, number>;
  scheduled: boolean;
  /** From savedCountsByUrl after the cross-page raw dedup (pre-validation); item counts when absent. */
  savedByUrl?: ReadonlyMap<string, number>;
  thresholds?: ListingDropThresholds;
};

/**
 * Precedence: all failed → rethrow; some failed → listing_url_failed; a page
 * dark or collapsed where it had rows → listing_url_empty; rows from a page no
 * longer configured → listing_urls_removed on a scheduled run (a manual run is
 * the operator's way of accepting a retired page, and proceeds with a warning);
 * else persist.
 */
export function decideListingOutcome(input: ListingDecisionInput): ListingOutcome {
  const thresholds = input.thresholds ?? DEFAULT_LISTING_DROP_THRESHOLDS;
  const { perUrl, targets, previous } = input;
  const failed = perUrl.filter((r) => r.error !== null);
  const succeeded = perUrl.filter((r) => r.error === null);

  if (perUrl.length > 0 && failed.length === perUrl.length) {
    return { kind: "rethrow", error: failed[0]!.error! };
  }

  const warnings: string[] = [];

  // per_url_counts only when there is more than one page — otherwise every
  // single-page site in the fleet gains a line in the nightly report.
  if (targets.length > 1) {
    const parts = perUrl.map((r) => {
      if (r.error !== null) return `${r.url}=ERR`;
      const saved = input.savedByUrl?.get(r.url) ?? r.items.length;
      const seen = r.seen === null ? "?" : String(r.seen);
      return `${r.url}=${saved}/${seen}`;
    });
    warnings.push(`per_url_counts: ${parts.join(", ")}`);
  }

  if (failed.length > 0) {
    const detail = failed.map((f) => `${f.url}: ${f.error}`).join("; ");
    return {
      kind: "soft_fail",
      failureCategory: LISTING_URL_FAILED,
      error: `${LISTING_URL_FAILED}: ${failed.length}/${perUrl.length} listing URL(s) failed — ${detail}`,
      warnings,
    };
  }

  // A page that loaded but produced nothing where it had rows, or a fraction
  // of them. Judged on extracted items (not the post-dedup count) so a job
  // that also appears on another page never makes its own page look dark.
  //
  // TWO GATES, and both are about not changing what a one-page site does.
  //
  // `targets.length > 1` — a single page returning nothing is already
  // `empty_results`, and a single page collapsing is already the site-level
  // `isSuspiciousDrop`. Running this as well would relabel both and short out
  // guards that have their own thresholds.
  //
  // `scheduled` — the manual path deliberately commits a collapse, because an
  // operator who knows a drop is real accepts it by scraping by hand
  // (scheduledRun.ts). Refusing here would take that escape hatch away, and
  // with it the only way to publish a company that has genuinely emptied out.
  // By the time anyone reaches for a manual run the refused nightly has
  // already named the page and both its counts in the attention queue.
  const dark: string[] = [];
  if (targets.length > 1 && input.scheduled) {
    for (const r of succeeded) {
      const had = previous.get(r.url) ?? 0;
      const now = r.items.length;
      if (now === 0) {
        warnings.push(`${LISTING_URL_EMPTY}: ${r.url}`);
        if (had > 0) dark.push(`${r.url} yielded 0, had ${had}`);
      } else if (had >= thresholds.minPrevious && now < had * thresholds.keepRatio) {
        dark.push(`${r.url} yielded ${now}, had ${had}`);
      }
    }
  }
  if (dark.length > 0) {
    return {
      kind: "soft_fail",
      failureCategory: LISTING_URL_EMPTY,
      error: `${LISTING_URL_EMPTY}: ${dark.join("; ")}`,
      warnings,
    };
  }

  // Rows tagged with a page nobody configured any more: an extension save that
  // wiped _meta, a partial PUT, a dropped primary. Loud, never silent.
  const configured = new Set(targets.map((t) => t.url));
  const removed: string[] = [];
  for (const [url, n] of previous) {
    if (url === "" || n === 0 || configured.has(url)) continue;
    removed.push(`${url} (${n} rows)`);
  }
  if (removed.length > 0) {
    for (const r of removed) warnings.push(`${LISTING_URLS_REMOVED}: ${r}`);
    if (input.scheduled) {
      return {
        kind: "soft_fail",
        failureCategory: LISTING_URLS_REMOVED,
        error: `${LISTING_URLS_REMOVED}: ${removed.join("; ")}`,
        warnings,
      };
    }
  }

  return { kind: "persist", warnings };
}
