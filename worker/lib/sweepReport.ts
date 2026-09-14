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
  defect?: string | null;
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
};

/** A withheld SKIP is carried as its own outcome rather than a column. */
export const WITHHELD_SKIP_OUTCOME = "withheld_skip";

/**
 * Listings the gate saved: the run ended FAILED with listings to lose.
 *
 * `apply_requires_login` is excluded — that path never deletes anything, and
 * counting it would inflate the number that justifies the whole design.
 */
function protectedListings(i: ReportItem): boolean {
  return (
    i.failureCategory !== null &&
    i.failureCategory !== "apply_requires_login" &&
    i.failureCategory !== "cancelled" &&
    i.outcome !== "success" &&
    i.outcome !== "soft_failure" &&
    i.jobsBefore > 0
  );
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
    };
  }
  return {
    selectedCount: sweep.selectedCount,
    ok: items.filter((i) => i.outcome === "success").length,
    failed: items.filter((i) => i.outcome === "hard_failure").length,
    silentDrift: items.filter((i) => i.outcome === "soft_failure").length,
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
  opts: { timeZone: string },
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

  const attention = needsAttention(sweep, items).length;
  return `${label} ${date}: ${sweep.selectedCount} sites, ${attention} need attention`;
}

type AttentionLine = { siteUrl: string; why: string };

/**
 * The part that earns the log: every site a human has to look at, once each.
 *
 * Deduplicated by site, because a site can qualify twice — protected AND
 * zeroed, say — and a count that double-counts makes the verdict line lie.
 */
export function needsAttention(sweep: ReportSweep, items: ReportItem[]): AttentionLine[] {
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
    if (protectedListings(i)) add(i, `${i.jobsBefore} listing(s) kept that a manual run would have deleted`);
    if (isStaleButGreen(i, sweep.startedAt)) {
      add(i, "reported success but its rows predate this sweep — the run never persisted");
    }
    if (zeroedOut(i)) add(i, `returned 0 listings, had ${i.jobsBefore}`);
    if (i.failureCategory === "oversize") add(i, "oversize: refused an implausible row count");
    if (i.outcome === "hard_failure") add(i, `failed (${i.failureCategory ?? "unknown"})`);

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
  opts: { timeZone: string },
): string {
  const lines: string[] = [];
  const counters = computeCounters(sweep, items);
  const attention = needsAttention(sweep, items);

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
  lines.push(`  ${String(counters.silentDrift).padStart(4)}  silent drift (empty_results / structure_changed)`);
  lines.push("");

  lines.push("Gate");
  lines.push(`  ${counters.listingsProtected} site(s) kept listings a manual run would have deleted`);
  lines.push(`  ${counters.wouldHavePromoted} would have been promoted, ${counters.wouldHaveDemoted} demoted`);
  lines.push(`  ${counters.skippedConflict} skipped (an operator was already scraping)`);

  return lines.join("\n");
}
