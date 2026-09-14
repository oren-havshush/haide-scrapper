// The nightly policy sweep, 06:00.
//
// Run:
//   npx tsx worker/sweep/policy.ts --dry-run   read-only; prints and exits
//   npx tsx worker/sweep/policy.ts --now       enqueue and wait, one at a time
//
// A separate timer and a separate run from the scrape sweep, which removes the
// ordering problem between them entirely.
//
// NO BREAKER, deliberately. A policy check that fails writes CHECK_FAILED on
// that one site; it is a diagnosis about that site's pages, not evidence that
// the next check would fail. Halting a 25-site pass over three of them would
// stop the only thing that notices a site has started refusing us.
//
// NO GATE either. The policy handler writes only `scrapingPolicyStatus` and
// `scrapingPolicyCheckedAt` — never status, never adminNote, never a listing —
// and Part 1a's non-destructive dispatcher protects it regardless.

import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { policyConfig, sweepConfig } from "../../src/lib/config";
import {
  becameRestricted,
  selectDuePolicyReviews,
  type PolicyCandidate,
} from "../../src/lib/policySelection";
import { enqueuePolicyReview } from "../../src/services/policyReviewService";
import { computeCounters, renderSweepReport, type ReportItem, type ReportSweep } from "../lib/sweepReport";

const log = (line: string) => console.info(line);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The sweep only checks live sites whose company profile has been captured. */
const SWEEP_STATUSES = ["ACTIVE", "REVIEW"] as const;

async function loadCandidates(): Promise<PolicyCandidate[]> {
  return prisma.site.findMany({
    select: {
      id: true,
      siteUrl: true,
      status: true,
      scrapingPolicyStatus: true,
      scrapingPolicyCheckedAt: true,
      companyProfileAt: true,
    },
  });
}

function selectionOptions() {
  return {
    now: new Date(),
    recheckIntervalDays: policyConfig.recheckIntervalDays,
    limit: sweepConfig.policyMaxPerNight,
    statuses: SWEEP_STATUSES,
    requireCompanyProfile: true,
  };
}

// ---------------------------------------------------------------------------
// Dry run — READ ONLY
// ---------------------------------------------------------------------------

async function dryRun(): Promise<number> {
  const opts = selectionOptions();
  log("=== policy sweep --dry-run (READ ONLY) ===");
  log(`time            ${opts.now.toISOString()}  (${sweepConfig.timezone})`);
  log(`recheck after   ${opts.recheckIntervalDays}d`);
  log(`cap per night   ${opts.limit}`);
  log("");

  const { selected, excluded, cappedOut } = selectDuePolicyReviews(await loadCandidates(), opts);

  log(`--- selection: ${selected.length} site(s) due ---`);
  selected.forEach((s, i) => {
    const last = s.scrapingPolicyCheckedAt
      ? s.scrapingPolicyCheckedAt.toISOString().slice(0, 10)
      : "never     ";
    log(`  ${String(i + 1).padStart(3)}  ${last}  ${s.scrapingPolicyStatus.padEnd(26)}  ${s.siteUrl}`);
  });
  if (cappedOut > 0) log(`  (${cappedOut} more were due, past the ${opts.limit}/night cap)`);

  log("");
  const byReason = new Map<string, number>();
  for (const e of excluded) {
    const key = e.reason.replace(/checked \d+d ago/, "checked recently");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  log(`--- excluded: ${excluded.length} ---`);
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${String(n).padStart(3)}  ${reason}`);
  }

  log("");
  log("--- nothing was written. Exiting. ---");
  return 0;
}

// ---------------------------------------------------------------------------
// The real run
// ---------------------------------------------------------------------------

type PolicyResult = {
  siteId: string;
  siteUrl: string;
  statusBefore: string;
  statusAfter: string;
  outcome: string;
  startedAt: Date;
  finishedAt: Date;
};

/** Wait for the POLICY_REVIEW job itself to be terminal. */
async function waitForJob(jobId: string, opts: { timeoutMs: number; pollMs: number }) {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const job = await prisma.workerJob.findUnique({
      where: { id: jobId },
      select: { status: true, error: true },
    });
    if (!job) return { status: "MISSING", error: null as string | null };
    if (job.status === "COMPLETED" || job.status === "FAILED") return job;
    if (Date.now() > deadline) return { status: "TIMED_OUT", error: null as string | null };
    await sleep(opts.pollMs);
  }
}

async function realRun(): Promise<number> {
  if (!sweepConfig.enabled) {
    log("[policy] SWEEP_ENABLED=false — refusing to run.");
    return 0;
  }
  if (!policyConfig.enabled) {
    log("[policy] ENABLE_POLICY_REVIEW=false — refusing to run.");
    return 0;
  }

  const opts = selectionOptions();
  const startedAt = opts.now;

  log("=== policy sweep --now ===");

  // Same stale-RUNNING rule as the scrape sweep: a killed run must not leave
  // the dashboard showing a sweep in progress for ever.
  const stale = await prisma.scrapeSweep.updateMany({
    where: { status: "RUNNING", kind: "POLICY" },
    data: { status: "FAILED", haltReason: "abandoned", finishedAt: new Date() },
  });
  if (stale.count > 0) log(`[policy] closed ${stale.count} stale RUNNING policy sweep(s)`);

  const { selected, cappedOut } = selectDuePolicyReviews(await loadCandidates(), opts);
  log(`[policy] ${selected.length} site(s) due${cappedOut > 0 ? ` (${cappedOut} past the cap)` : ""}`);

  const sweep = await prisma.scrapeSweep.create({
    data: {
      kind: "POLICY",
      trigger: "manual",
      status: "RUNNING",
      startedAt,
      selectedCount: selected.length,
    },
  });
  log(`[policy] sweep row ${sweep.id}`);

  const results: PolicyResult[] = [];

  // One site at a time, same resident pattern as the scrape sweep: the worker
  // stays available for manual work, and each result is recorded before the
  // next is queued.
  for (const site of selected) {
    const itemStart = new Date();
    log(`[policy] -> ${site.siteUrl} (${site.scrapingPolicyStatus})`);

    const { jobId, alreadyQueued } = await enqueuePolicyReview(site.id, "nightly_sweep");
    if (alreadyQueued) {
      log(`[policy] <- already queued, skipping`);
      results.push({
        siteId: site.id,
        siteUrl: site.siteUrl,
        statusBefore: site.scrapingPolicyStatus,
        statusAfter: site.scrapingPolicyStatus,
        outcome: "skipped_conflict",
        startedAt: itemStart,
        finishedAt: new Date(),
      });
      continue;
    }

    const job = await waitForJob(jobId, {
      timeoutMs: (policyConfig.maxPolicyFetchSeconds + 60) * 1000,
      pollMs: sweepConfig.pollIntervalMs,
    });

    const after = await prisma.site.findUnique({
      where: { id: site.id },
      select: { scrapingPolicyStatus: true },
    });
    const statusAfter = after?.scrapingPolicyStatus ?? site.scrapingPolicyStatus;

    // "Newly RESTRICTED" is a TRANSITION, not a census: a site already
    // RESTRICTED last month is not news tonight.
    const outcome = becameRestricted(site.scrapingPolicyStatus, statusAfter)
      ? "newly_restricted"
      : job.status === "COMPLETED"
        ? "success"
        : job.status === "TIMED_OUT"
          ? "timed_out"
          : "check_failed";

    log(`[policy] <- ${outcome}  ${site.scrapingPolicyStatus} -> ${statusAfter}`);

    results.push({
      siteId: site.id,
      siteUrl: site.siteUrl,
      statusBefore: site.scrapingPolicyStatus,
      statusAfter,
      outcome,
      startedAt: itemStart,
      finishedAt: new Date(),
    });

    await prisma.scrapeSweepItem.create({
      data: {
        sweepId: sweep.id,
        siteId: site.id,
        phase: "policy",
        outcome,
        // The resulting policy status, and the one it replaced — together they
        // make "newly" answerable from the row alone.
        failureCategory: statusAfter,
        siteStatus: site.status,
        wouldDemoteTo: null,
        wouldPromoteTo: site.scrapingPolicyStatus,
        jobsBefore: 0,
        jobsAfter: 0,
        startedAt: itemStart,
        finishedAt: new Date(),
      },
    });

    if (policyConfig.jobDelayMs > 0) await sleep(policyConfig.jobDelayMs);
  }

  // Closed through the same renderer as the scrape sweep, so the verdict line,
  // the stored logText and the journal are one string in all three places.
  const finishedAt = new Date();
  const sweepRow: ReportSweep = {
    id: sweep.id,
    kind: "POLICY",
    status: "COMPLETED",
    trigger: sweep.trigger,
    startedAt,
    finishedAt,
    selectedCount: selected.length,
    haltReason: null,
  };
  const items: ReportItem[] = results.map((r) => ({
    siteId: r.siteId,
    siteUrl: r.siteUrl,
    phase: "policy",
    outcome: r.outcome,
    failureCategory: r.statusAfter,
    jobsBefore: 0,
    jobsAfter: 0,
    newestJobAt: null,
    siteStatus: r.statusAfter,
    wouldDemoteTo: null,
    wouldPromoteTo: null,
  }));

  const counters = computeCounters(sweepRow, items);
  const logText = renderSweepReport(sweepRow, items, { timeZone: sweepConfig.timezone });

  await prisma.scrapeSweep.update({
    where: { id: sweep.id },
    data: { status: "COMPLETED", finishedAt, ...counters, logText },
  });

  const newly = results.filter((r) => r.outcome === "newly_restricted");
  if (newly.length > 0) {
    log("");
    log(`[policy] ${newly.length} site(s) newly restricted:`);
    for (const r of newly) log(`[policy]   ${r.siteUrl}: ${r.statusBefore} -> ${r.statusAfter}`);
  }

  log("");
  log(logText);
  return 0;
}

// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry-run");
  const now = argv.includes("--now");
  if (!dry && !now) throw new Error("one of --dry-run or --now is required");

  const code = dry ? await dryRun() : await realRun();
  await prisma.$disconnect();
  process.exit(code);
}

main().catch(async (err) => {
  console.error("[policy] fatal:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
