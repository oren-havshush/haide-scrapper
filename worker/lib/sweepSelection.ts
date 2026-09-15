// What the nightly scrapes, in what order, and what "success" means.
//
// All three live here because they have to agree. The success definition is
// used by selection (the 20h window), by the breaker's reset, and by the 7-day
// qualification; if any two drifted, a site could be "too fresh to scrape" and
// "never succeeded" at the same time.

import { countUsableFieldMappings, getApplyRequiresLogin } from "./fieldMappings";

// ---------------------------------------------------------------------------
// Success (N5)
// ---------------------------------------------------------------------------

/**
 * A run worked.
 *
 * COMPLETED ALONE IS NOT SUCCESS. Two early-return paths in scrape.ts write
 * `status: "COMPLETED"` *with* a failureCategory — `empty_results` when nothing
 * was extracted, `structure_changed` when nothing survived validation. Counting
 * those as successes would let a site whose selectors died silently reset the
 * breaker, register as "recently healthy", and satisfy the 20h window: the site
 * would never be scraped again and never be reported. A run that found nothing
 * is not a run that worked.
 */
export function isSuccessfulRun(
  run: { status: string; failureCategory: string | null } | null | undefined,
): boolean {
  if (!run) return false;
  return run.status === "COMPLETED" && run.failureCategory == null;
}

/**
 * Hard failures are evidence about the infrastructure — a browser that will not
 * launch, a database that is gone. Three in a row halt the sweep.
 *
 * `empty_results` and `structure_changed` are per-site config death and never
 * halt; `apply_requires_login` and `oversize` are decisions, not faults.
 */
export const HARD_FAILURE_CATEGORIES = ["timeout", "other"] as const;

/**
 * The undersize guard's refusal (scheduledRun.ts): the run extracted a fraction
 * of the site's listings and wrote nothing. Its own outcome, because the report
 * has to name it with both counts — it is neither a fault nor silent drift.
 */
export const SUSPICIOUS_DROP = "suspicious_drop";

export type Outcome = "success" | "hard_failure" | "soft_failure" | "suspicious_drop" | "other";

export function classifyOutcome(run: {
  status: string;
  failureCategory: string | null;
}): Outcome {
  if (isSuccessfulRun(run)) return "success";
  if (run.failureCategory === SUSPICIOUS_DROP) return "suspicious_drop";
  if (
    run.status === "FAILED" &&
    run.failureCategory != null &&
    (HARD_FAILURE_CATEGORIES as readonly string[]).includes(run.failureCategory)
  ) {
    return "hard_failure";
  }
  if (
    run.failureCategory === "empty_results" ||
    run.failureCategory === "structure_changed"
  ) {
    return "soft_failure";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Sites the nightly may scrape at all. ANALYSIS is never run by the sweep. */
export const SWEEP_SITE_STATUSES = ["ACTIVE", "REVIEW"] as const;

/** A site is due when its last success is older than this. */
export const DEFAULT_FRESH_WINDOW_MS = 20 * 60 * 60_000; // 20 hours

export type SelectableSite = {
  id: string;
  siteUrl: string;
  status: string;
  fieldMappings: unknown;
  /** Most recent run meeting the success definition. Null if never. */
  lastSuccessAt: Date | null;
  /** Most recent run of ANY outcome. Null if never scraped. */
  lastAttemptAt: Date | null;
};

export type Excluded = { site: SelectableSite; reason: string };

export type Selection = {
  selected: SelectableSite[];
  excluded: Excluded[];
};

/**
 * Ordering is by last ATTEMPT, any status — never by last success. (R6)
 *
 * Ordering by last success pins permanently-failing sites at the head of the
 * queue forever: three hard failures halt the sweep before it reaches anything
 * healthy, and tomorrow the same three lead again, so the tail of the fleet is
 * never scraped at all. Ordering by attempt sends a failing site to the back
 * like everything else, which moves the halt point each night.
 *
 * Never-attempted sites go first — they are the ones nothing is known about.
 */
export function compareByLastAttempt(a: SelectableSite, b: SelectableSite): number {
  const at = a.lastAttemptAt?.getTime() ?? -Infinity;
  const bt = b.lastAttemptAt?.getTime() ?? -Infinity;
  if (at !== bt) return at - bt;
  // Stable, deterministic tiebreak so two runs of --dry-run agree.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function selectSitesForSweep(
  sites: SelectableSite[],
  opts: { now: Date; freshWindowMs?: number },
): Selection {
  const freshWindowMs = opts.freshWindowMs ?? DEFAULT_FRESH_WINDOW_MS;
  const cutoff = opts.now.getTime() - freshWindowMs;

  const selected: SelectableSite[] = [];
  const excluded: Excluded[] = [];

  for (const site of sites) {
    if (!(SWEEP_SITE_STATUSES as readonly string[]).includes(site.status)) {
      excluded.push({ site, reason: `status ${site.status} is not scraped by the sweep` });
      continue;
    }

    // Not "has fieldMappings" — has USABLE ones. handleScrapeJob refuses a site
    // whose parsed mappings are empty and calls failScrapeRun; selecting it
    // would queue a site only to have the run fail for a reason we already knew.
    const mappingCount = countUsableFieldMappings(site.fieldMappings);
    if (mappingCount === 0) {
      excluded.push({ site, reason: "no usable fieldMappings (would fail immediately)" });
      continue;
    }

    if (getApplyRequiresLogin(site.fieldMappings)) {
      excluded.push({ site, reason: "applyRequiresLogin — nothing can be applied to" });
      continue;
    }

    if (site.lastSuccessAt && site.lastSuccessAt.getTime() > cutoff) {
      excluded.push({
        site,
        reason: `succeeded ${Math.round((opts.now.getTime() - site.lastSuccessAt.getTime()) / 3_600_000)}h ago, inside the ${Math.round(freshWindowMs / 3_600_000)}h window`,
      });
      continue;
    }

    selected.push(site);
  }

  selected.sort(compareByLastAttempt);
  return { selected, excluded };
}
