// The night's report, and the counters on the sweep row.
//
// One renderer, from the sweep row plus its items. The driver calls it to write
// `logText` and print to stdout; the dashboard displays what it stored. Nothing
// re-derives the text a second way, so the journal, the database and the screen
// cannot disagree.
//
// The counters are computed HERE, from the items, for both the COMPLETED and the
// HALTED path. They used to be assembled inline at the end of a successful
// sweep, which meant a halted night wrote zeros for wouldHaveDemoted,
// wouldHavePromoted and listingsProtected — the three numbers that say what the
// gate saved, silently absent from exactly the nights something went wrong.

import { DEFAULT_DROP_THRESHOLDS, isSuspiciousDrop, type DropThresholds } from "./scheduledRun";
import { LISTING_SOFT_CATEGORIES } from "./listingTargets";

/**
 * A multi-page site that refused to publish a partial set. Soft, like drift,
 * but the opposite in kind: drift is a site that changed under us and said
 * nothing, this is the worker declining to shrink what it publishes — and the
 * run already named the pages, so the queue quotes them instead of guessing.
 */
function isListingRefusal(category: string | null): boolean {
  return category != null && (LISTING_SOFT_CATEGORIES as readonly string[]).includes(category);
}

/**
 * A site that returned nothing and had nothing. Not a regression — it is a
 * company with no open roles, or one whose board has been empty for weeks.
 *
 * `empty_results` is classified `soft_failure` whatever the site held before,
 * so without this a permanently-empty site sits in the same bucket, and the
 * same alert ratio, as one that emptied out last night. Only the second is
 * news.
 */
function isNoJobs(i: ReportItem): boolean {
  return i.outcome === "soft_failure" && i.failureCategory === "empty_results" && i.jobsBefore === 0;
}

/** Anything the report needs about the sweep itself. */
export type ReportSweep = {
  id: string;
  kind: string; // "SCRAPE" | "POLICY"
  status: string; // RUNNING | COMPLETED | HALTED | FAILED
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  selectedCount: number;
  haltReason: string | null;
};

/**
 * One site's row. `siteUrl` is joined in by the caller; `defect` is in-memory
 * only (the driver has it, the dashboard does not) and simply renders nothing
 * when absent.
 */
export type ReportItem = {
  siteId: string;
  siteUrl: string;
  phase: string;
  outcome: string;
  failureCategory: string | null;
  jobsBefore: number;
  jobsAfter: number;
  newestJobAt: Date | null;
  siteStatus: string;
  wouldDemoteTo: string | null;
  wouldPromoteTo: string | null;
  /** Policy phase only: the site's scrapingPolicyStatus before and after tonight. */
  policyStatusBefore?: string | null;
  policyStatusAfter?: string | null;
  /**
   * Scrape phase: the listings the run extracted and was prepared to write
   * (its ScrapeRun.validJobs). Equal to jobsAfter when the write committed; the
   * refused count when the undersize guard or the oversize cap refused it.
   */
  scrapedCount?: number | null;
  /** Scrape phase: the run's own ScrapeRun.warnings, "type: detail" strings. */
  warnings?: readonly string[] | null;
  defect?: string | null;
};

/**
 * A site selection left out of the night, and why.
 *
 * `kind: "fresh"` marks the one reason that is not a problem: the site
 * succeeded recently enough to be inside the fresh window. Carried as a field
 * rather than matched out of `reason`, which is a human sentence carrying an
 * hour count and would change the moment someone reworded it.
 */
export type SkippedSite = { siteUrl: string; reason: string; kind?: "fresh" };

/**
 * Warning types whose value is WHICH site they happened to. Everything else is
 * a count: a fleet-wide quality signal, acted on by fixing a rule once.
 */
const WARNINGS_THAT_NAME_SITES: ReadonlySet<string> = new Set(["job_count_drop", "near_timeout"]);

export type ReportOptions = {
  timeZone: string;
  /** Selection exclusions. Absent means none were passed, and none are printed. */
  skipped?: readonly SkippedSite[];
  /** The undersize guard's thresholds, so the report applies the rule the run did. */
  dropThresholds?: DropThresholds;
};

/**
 * Policy outcomes that ESTABLISHED a status tonight — the only ones "checked"
 * counts. Not attempts (a dead worker produces 25 attempts and zero checks),
 * and not every COMPLETED job either: the handler completes its own failures
 * with the site set to CHECK_FAILED, which established nothing. The mapping
 * from job end to outcome lives in policyOutcome.ts; policySweepReport.test.ts
 * pins the two together.
 */
export const POLICY_CHECKED_OUTCOMES: readonly string[] = ["success", "newly_restricted"];

/** Policy outcomes that are a failure to establish a status tonight. */
export const POLICY_FAILED_OUTCOMES: readonly string[] = [
  "check_failed",
  "job_failed",
  "timed_out",
  "worker_not_draining",
];

const RESTRICTING: readonly string[] = ["RESTRICTED", "REQUIRES_WRITTEN_PERMISSION"];

export type SweepCounters = {
  selectedCount: number;
  ok: number;
  failed: number;
  silentDrift: number;
  skippedConflict: number;
  wouldHaveDemoted: number;
  wouldHavePromoted: number;
  listingsProtected: number;
  /** Multi-page sites that declined to publish a partial set. Not drift. */
  listingRefusals: number;
  /** Sites that returned nothing and had nothing. Not drift either. */
  noJobs: number;
};

/** A withheld SKIP is carried as its own outcome rather than a column. */
export const WITHHELD_SKIP_OUTCOME = "withheld_skip";

/**
 * Listings the gate saved: a run that ended without publishing, on a site with
 * listings to lose.
 *
 * Two kinds qualify, and they arrive by different routes.
 *
 *   - A scheduled run that FAILED. The gate withheld the delete that a manual
 *     run would have performed.
 *   - A multi-page site that REFUSED to publish a partial set. Its two
 *     scheduled-only categories do not fire on a manual run at all, so a manual
 *     run would have written the shrunken set and deleted the missing page's
 *     rows. That is the same save by a different mechanism.
 *
 * The second used to be excluded with the rest of `soft_failure`, which filed
 * it under silent drift — the opposite thing. Drift is a site that changed
 * under us and said nothing; this is the worker declining to shrink what it
 * publishes, and it is exactly what the counter's own line describes.
 *
 * `apply_requires_login` is excluded — that path never deletes anything, and
 * counting it would inflate the number that justifies the whole design.
 */
function protectedListings(i: ReportItem): boolean {
  if (i.failureCategory === null) return false;
  if (i.failureCategory === "apply_requires_login" || i.failureCategory === "cancelled") return false;
  if (i.jobsBefore <= 0) return false;
  if (i.outcome === "success") return false;
  if (i.outcome === "soft_failure") return isListingRefusal(i.failureCategory);
  return true;
}

export function computeCounters(sweep: ReportSweep, items: ReportItem[]): SweepCounters {
  if (sweep.kind === "POLICY") {
    // Same columns, policy meanings. Without this a night of 25 timeouts wrote
    // ok 0, failed 0 — the dashboard's counter grid reading as an empty night.
    return {
      selectedCount: sweep.selectedCount,
      // The same list as the verdict line's "checked", so the two cannot drift.
      ok: items.filter((i) => POLICY_CHECKED_OUTCOMES.includes(i.outcome)).length,
      failed: items.filter((i) => POLICY_FAILED_OUTCOMES.includes(i.outcome)).length,
      silentDrift: 0,
      skippedConflict: items.filter((i) => i.outcome === "skipped_conflict").length,
      wouldHaveDemoted: 0,
      wouldHavePromoted: 0,
      listingsProtected: 0,
      listingRefusals: 0,
      noJobs: 0,
    };
  }
  // The three shapes `soft_failure` covers, kept apart. One is a problem, one
  // is the worker doing its job, and one is a company with no open roles.
  const soft = items.filter((i) => i.outcome === "soft_failure");
  return {
    selectedCount: sweep.selectedCount,
    ok: items.filter((i) => i.outcome === "success").length,
    failed: items.filter((i) => i.outcome === "hard_failure").length,
    silentDrift: soft.filter((i) => !isListingRefusal(i.failureCategory) && !isNoJobs(i)).length,
    listingRefusals: soft.filter((i) => isListingRefusal(i.failureCategory)).length,
    noJobs: soft.filter(isNoJobs).length,
    skippedConflict: items.filter((i) => i.outcome === "skipped_conflict").length,
    wouldHaveDemoted: items.filter((i) => i.wouldDemoteTo).length,
    wouldHavePromoted: items.filter((i) => i.wouldPromoteTo).length,
    listingsProtected: items.filter(protectedListings).length,
  };
}

/**
 * Stale-but-green: the run says success, but the rows are older than the sweep.
 *
 * Computed from `Job` (`newestJobAt` is `max(Job.createdAt)` for the site), NOT
 * from the outcome — that is the entire point. A healthy scrape recreates every
 * row inside its transaction, so a `createdAt` predating the sweep proves the
 * run never reached that line, whatever status it wrote. It catches what the
 * breaker cannot: a run that reported success and changed nothing.
 */
export function isStaleButGreen(item: ReportItem, sweepStartedAt: Date): boolean {
  if (item.outcome !== "success") return false;
  if (item.newestJobAt === null) return false;
  return item.newestJobAt.getTime() < sweepStartedAt.getTime();
}

/** A site that had listings and now reports none. */
function zeroedOut(i: ReportItem): boolean {
  return i.jobsBefore > 0 && i.jobsAfter === 0;
}

/** The date label, in the sweep's timezone. */
export function sweepDate(when: Date, timeZone: string): string {
  try {
    // en-CA gives YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(when);
  } catch {
    // An unknown timezone must not lose the report.
    return when.toISOString().slice(0, 10);
  }
}

/**
 * The verdict line — first line of the report, the journal headline, the
 * dashboard row title, and later the email subject unchanged. By the time mail
 * is switched on it will have been read every morning for weeks.
 *
 * The date is the sweep's LOCAL date, so a 03:00 scrape and its 06:00 policy run
 * label the same night. A UTC label would split them across days for exactly the
 * runs worth reading.
 */
export function verdictLine(
  sweep: ReportSweep,
  items: ReportItem[],
  opts: ReportOptions,
): string {
  const label = sweep.kind === "POLICY" ? "Policy sweep" : "Nightly sweep";
  const date = sweepDate(sweep.startedAt, opts.timeZone);

  if (sweep.status === "HALTED") {
    const hard = items.filter((i) => i.outcome === "hard_failure").length;
    return `${label} ${date}: HALTED after ${hard} failures — ${items.length} of ${sweep.selectedCount} done`;
  }

  // A sweep that stopped itself (worker not draining). Without its own shape it
  // fell through to the clean-night line and read as a quiet night.
  if (sweep.status === "FAILED") {
    return `${label} ${date}: FAILED — ${sweep.haltReason ?? "no reason recorded"} — ${items.length} of ${sweep.selectedCount} done`;
  }

  if (sweep.kind === "POLICY") {
    // "checked" is a status established, never an attempt. Failures appear only
    // when there are some, so a clean night keeps the two-number shape.
    const checked = items.filter((i) => POLICY_CHECKED_OUTCOMES.includes(i.outcome)).length;
    const failed = items.filter((i) => POLICY_FAILED_OUTCOMES.includes(i.outcome)).length;
    const restricted = items.filter((i) => i.outcome === "newly_restricted").length;
    const failedPart = failed > 0 ? `${failed} failed, ` : "";
    return `${label} ${date}: ${checked} checked, ${failedPart}${restricted} newly RESTRICTED`;
  }

  const attention = needsAttention(sweep, items, opts).length;
  return `${label} ${date}: ${sweep.selectedCount} sites, ${attention} need attention`;
}

type AttentionLine = { siteUrl: string; why: string };

/**
 * The part that earns the log: every site a human has to look at, once each.
 *
 * Deduplicated by site, because a site can qualify twice — protected AND
 * zeroed, say — and a count that double-counts makes the verdict line lie.
 *
 * It is the remediation queue, so a site is NAMED here, never only counted
 * elsewhere. The step 9 catch-up run read "0 need attention" over twelve
 * drifted sites and a 433 -> 8 success, because drift was only a number under
 * Outcomes and nothing looked at a drop that did not reach zero.
 */
export function needsAttention(
  sweep: ReportSweep,
  items: ReportItem[],
  opts: Partial<ReportOptions> = {},
): AttentionLine[] {
  const thresholds = opts.dropThresholds ?? DEFAULT_DROP_THRESHOLDS;
  const timeZone = opts.timeZone ?? "UTC";
  const reasons = new Map<string, string[]>();
  const add = (i: ReportItem, why: string) => {
    const list = reasons.get(i.siteUrl) ?? [];
    list.push(why);
    reasons.set(i.siteUrl, list);
  };

  for (const i of items) {
    if (i.wouldPromoteTo) add(i, `would have promoted to ${i.wouldPromoteTo} — a human promotes`);
    if (i.wouldDemoteTo) add(i, `would have demoted to ${i.wouldDemoteTo}`);
    if (i.outcome === WITHHELD_SKIP_OUTCOME) add(i, "would have been SKIPPED (login-gated apply)");
    // A refused drop and a listing refusal protected their listings too, but
    // each has its own line below with both counts; the generic one beside it
    // would only repeat it.
    if (
      protectedListings(i) &&
      i.outcome !== "suspicious_drop" &&
      !isListingRefusal(i.failureCategory)
    ) {
      add(i, `${i.jobsBefore} listing(s) kept that a manual run would have deleted`);
    }
    if (isStaleButGreen(i, sweep.startedAt)) {
      add(i, "reported success but its rows predate this sweep — the run never persisted");
    }
    if (zeroedOut(i)) add(i, `returned 0 listings, had ${i.jobsBefore}`);
    if (i.failureCategory === "oversize") add(i, "oversize: refused an implausible row count");
    if (i.outcome === "hard_failure") add(i, `failed (${i.failureCategory ?? "unknown"})`);

    // --- scrape phase: drift and drops ---
    if (i.outcome === "soft_failure" && isListingRefusal(i.failureCategory)) {
      const detail = (i.warnings ?? [])
        .map((w) => String(w))
        .filter((w) => w.startsWith("listing_url"))
        .join("; ");
      add(
        i,
        `refused to publish a partial set (${i.failureCategory}): ${i.jobsAfter} listing(s) kept` +
          (detail ? ` — ${detail}` : ""),
      );
    } else if (isNoJobs(i)) {
      // Counted apart from drift, but NOT dropped from the queue. A site that
      // has nothing and returns nothing is not a regression — it is either a
      // company with no open roles or a config that has never worked, and the
      // report cannot tell which. The step 9 fixture settles what to do about
      // that: all four sites in this state that night (se.com, xnes,
      // careers.jnj.com, safelog) turned out to be broken configs, two of them
      // since rebuilt and two retired. Naming them is how that was found.
      add(i, "returned no jobs, and has none stored — no open roles, or a config that never worked");
    } else if (i.outcome === "soft_failure") {
      const newest = i.newestJobAt ? sweepDate(i.newestJobAt, timeZone) : "none";
      add(
        i,
        `silent drift (${i.failureCategory ?? "unknown"}): ${i.jobsAfter} listing(s) on the site, newest ${newest}`,
      );
    }
    if (i.outcome === "suspicious_drop") {
      add(
        i,
        `suspicious drop refused: scraped ${i.scrapedCount ?? "?"}, had ${i.jobsBefore} — ` +
          `nothing written, ${i.jobsAfter} listing(s) kept`,
      );
    }
    // The same rule the undersize guard applies, on what was actually written.
    // After the guard a scheduled success should never get here; it is how a
    // night from before it (and any way round it) still reaches this list.
    // Scrape phase only: a policy item's counts are read, never written.
    if (
      i.phase === "scrape" &&
      i.outcome === "success" &&
      isSuspiciousDrop(i.jobsBefore, i.jobsAfter, thresholds)
    ) {
      const pct = Math.round(((i.jobsAfter - i.jobsBefore) / i.jobsBefore) * 100);
      add(i, `listings fell ${i.jobsBefore} -> ${i.jobsAfter} (${pct}%) and were written`);
    }

    // --- policy phase ---
    // Every outcome the verdict line counts, or that means no status was
    // established tonight, names its site here.
    const policyMove = `${i.policyStatusBefore ?? "?"} -> ${i.policyStatusAfter ?? "?"}`;
    if (i.outcome === "newly_restricted") add(i, `newly restricted: ${policyMove}`);
    if (i.outcome === "check_failed") add(i, "policy check failed: the handler could not establish a status");
    if (i.outcome === "timed_out") add(i, "policy check timed out after it was claimed");
    if (i.outcome === "job_failed") add(i, "policy job ended FAILED");
    if (i.outcome === "worker_not_draining") add(i, "worker not draining — the job was taken back");
    if (
      i.phase === "policy" &&
      i.outcome !== "newly_restricted" &&
      !RESTRICTING.includes(i.policyStatusBefore ?? "") &&
      RESTRICTING.includes(i.policyStatusAfter ?? "")
    ) {
      // The job did not complete, yet the site's status moved into a
      // restricting one. Not counted as newly RESTRICTED — the check did not
      // finish — but never silent either.
      add(i, `policy status is now restricting (${policyMove}) although the job did not complete`);
    }

    if (i.defect) add(i, `DEFECT: ${i.defect}`);
  }

  return [...reasons.entries()].map(([siteUrl, why]) => ({ siteUrl, why: why.join("; ") }));
}

/** The whole report. One screen for a clean night. */
export function renderSweepReport(
  sweep: ReportSweep,
  items: ReportItem[],
  opts: ReportOptions,
): string {
  const lines: string[] = [];
  const counters = computeCounters(sweep, items);
  const attention = needsAttention(sweep, items, opts);

  lines.push(verdictLine(sweep, items, opts));
  lines.push("");

  // --- Ran ---------------------------------------------------------------
  const durationMs = (sweep.finishedAt ?? new Date()).getTime() - sweep.startedAt.getTime();
  lines.push("Ran");
  lines.push(`  started   ${sweep.startedAt.toISOString()} (${opts.timeZone} date ${sweepDate(sweep.startedAt, opts.timeZone)})`);
  lines.push(`  finished  ${sweep.finishedAt ? sweep.finishedAt.toISOString() : "—"}`);
  lines.push(`  duration  ${Math.round(durationMs / 60_000)}m`);
  lines.push(`  trigger   ${sweep.trigger}`);
  lines.push(`  selected  ${sweep.selectedCount}, attempted ${items.length}`);
  if (items.length < sweep.selectedCount) {
    lines.push(`  NOT REACHED ${sweep.selectedCount - items.length} site(s)`);
  }
  if (sweep.status === "HALTED") {
    lines.push(`  HALTED    ${sweep.haltReason ?? "(no reason recorded)"}`);
  }
  if (opts.skipped) {
    // Named, with the reason: a site selection left out is a site nobody looked
    // at tonight, and "no usable fieldMappings" is a fix waiting for someone.
    lines.push(`  skipped   ${opts.skipped.length} at selection`);
    // The fresh window is not a problem, and on a re-run it is nearly the whole
    // fleet — 140 lines of "succeeded 3h ago" burying the two selections that
    // were skipped for a reason someone has to fix. One count line.
    const fresh = opts.skipped.filter((s) => s.kind === "fresh");
    if (fresh.length > 0) {
      lines.push(`    ${fresh.length} too recent to scrape (inside the fresh window)`);
    }
    for (const s of opts.skipped) {
      if (s.kind === "fresh") continue;
      lines.push(`    ${s.siteUrl} — ${s.reason}`);
    }
  }
  lines.push("");

  // --- Changed -----------------------------------------------------------
  const changed = items.filter((i) => i.jobsBefore !== i.jobsAfter);
  const totalBefore = items.reduce((n, i) => n + i.jobsBefore, 0);
  const totalAfter = items.reduce((n, i) => n + i.jobsAfter, 0);
  lines.push("Changed");
  lines.push(`  fleet totals  ${totalBefore} -> ${totalAfter} listing(s)`);
  if (changed.length === 0) {
    lines.push("  no site changed its listing count");
  } else {
    for (const i of changed) {
      const delta = i.jobsAfter - i.jobsBefore;
      lines.push(`  ${i.jobsBefore} -> ${i.jobsAfter} (${delta > 0 ? "+" : ""}${delta})  ${i.siteUrl}`);
    }
  }
  lines.push("");

  // --- Needs attention ---------------------------------------------------
  lines.push(`Needs attention (${attention.length})`);
  if (attention.length === 0) {
    lines.push("  nothing");
  } else {
    for (const a of attention) lines.push(`  ${a.siteUrl}\n      ${a.why}`);
  }
  lines.push("");

  // --- Categories --------------------------------------------------------
  // Silent drift gets its own bucket rather than sitting under "failures": a
  // site that returned nothing did not fail, it changed, and the two need
  // different responses.
  const byCategory = new Map<string, number>();
  for (const i of items) {
    if (i.outcome === "soft_failure") continue; // counted below, separately
    const key = i.failureCategory ?? (i.outcome === "success" ? "ok" : i.outcome);
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  lines.push("Outcomes");
  for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${String(n).padStart(4)}  ${cat}`);
  }
  // Three lines, not one. They were a single "silent drift or refusal" bucket,
  // which put a site that emptied out last night, a site that has been empty
  // for a month, and the worker declining to shrink a site it could not fully
  // see, under one number — and only the first is news.
  lines.push(
    `  ${String(counters.silentDrift).padStart(4)}  silent drift (empty_results / structure_changed)`,
  );
  if (counters.listingRefusals > 0) {
    lines.push(
      `  ${String(counters.listingRefusals).padStart(4)}  refused to publish a partial set (listing_*)`,
    );
  }
  if (counters.noJobs > 0) {
    lines.push(`  ${String(counters.noJobs).padStart(4)}  returned no jobs and had none`);
  }
  lines.push("");

  lines.push("Gate");
  lines.push(`  ${counters.listingsProtected} site(s) kept listings a manual run would have deleted`);
  lines.push(`  ${counters.wouldHavePromoted} would have been promoted, ${counters.wouldHaveDemoted} demoted`);
  lines.push(`  ${counters.skippedConflict} skipped (an operator was already scraping)`);

  // --- Warnings ----------------------------------------------------------
  // Each run's own ScrapeRun.warnings, grouped by type. Surfaced, not counted
  // as needing attention: on the step 9 night 61 of 140 sites warned, most of
  // them about location quality, and a queue that long is one nobody reads.
  // Last, so the report's first screen stays the verdict and the queue.
  const byType = new Map<string, Array<{ siteUrl: string; detail: string }>>();
  let warnedSites = 0;
  for (const i of items) {
    if (!i.warnings || i.warnings.length === 0) continue;
    warnedSites++;
    for (const w of i.warnings) {
      const text = String(w);
      const colon = text.indexOf(":");
      const type = colon > 0 ? text.slice(0, colon).trim() : "other";
      const detail = colon > 0 ? text.slice(colon + 1).trim() : text.trim();
      const list = byType.get(type) ?? [];
      list.push({ siteUrl: i.siteUrl, detail });
      byType.set(type, list);
    }
  }
  if (warnedSites > 0) {
    lines.push("");
    lines.push(`Warnings (${warnedSites} sites)`);
    const ordered = [...byType.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [type, list] of ordered) {
      lines.push(`  ${type} (${list.length})`);
      // Only the two that are about a SITE. On the step 9 night 61 of 140 sites
      // warned, most of them about location quality — a per-site list that long
      // is one nobody reads, and a location warning is acted on by fixing the
      // rule once, not by visiting 61 sites. These two are different: each names
      // one site whose config or budget needs looking at, tonight.
      if (!WARNINGS_THAT_NAME_SITES.has(type)) continue;
      for (const w of list) lines.push(`    ${w.siteUrl}${w.detail ? ` — ${w.detail}` : ""}`);
    }
  }

  return lines.join("\n");
}
