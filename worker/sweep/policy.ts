// The nightly policy sweep, 06:00.
//
// Run:
//   npx tsx worker/sweep/policy.ts --dry-run   read-only; prints and exits
//   npx tsx worker/sweep/policy.ts --now       enqueue and wait, one at a time
//
// A separate timer and a separate run from the scrape sweep, which removes the
// ordering problem between them entirely. It does NOT remove the overlap: the
// scrape sweep can still be running until 08:00 on the same FIFO queue, so a
// policy job may wait behind a long scrape before it is claimed. See
// worker/lib/policyJobWait.ts for how the wait is timed.
//
// NO BREAKER, deliberately. A policy check that fails writes CHECK_FAILED on
// that one site; it is a diagnosis about that site's pages, not evidence that
// the next check would fail. Halting a 25-site pass over three of them would
// stop the only thing that notices a site has started refusing us. A worker
// that is not draining is different — that is about the infrastructure — and
// stops the sweep as FAILED, exactly as the scrape sweep's probe does.
//
// NO GATE either. The policy handler writes only `scrapingPolicyStatus` and
// `scrapingPolicyCheckedAt` — never status, never adminNote, never a listing —
// and Part 1a's non-destructive dispatcher protects it regardless.

import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { policyConfig, sweepConfig } from "../../src/lib/config";
import { selectDuePolicyReviews, type PolicyCandidate } from "../../src/lib/policySelection";
import { enqueuePolicyReview } from "../../src/services/policyReviewService";
import { BUSY_EVIDENCE_WINDOW_MS } from "../lib/drainProbe";
import { waitForPolicyJob } from "../lib/policyJobWait";
import {
  decidePolicyOutcome,
  toPolicyItemRow,
  toPolicyReportItem,
  type PolicySiteResult,
} from "../lib/policyOutcome";
import {
  cancelPendingJobById,
  closeSweep,
  readQueueState,
  resolveStaleSweeps,
  sleep,
} from "./sweepCommon";

const log = (line: string) => console.info(line);

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
  log(`run budget      ${policyConfig.maxPolicyFetchSeconds + 60}s from startedAt`);
  log("");

  const staleSweeps = await resolveStaleSweeps("POLICY", true, log);
  log(`stale RUNNING policy sweeps: ${staleSweeps}`);
  const active = await prisma.workerJob.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } });
  log(`active worker jobs:          ${active}`);
  log("");

  const { selected, excluded, cappedOut } = selectDuePolicyReviews(await loadCandidates(), opts);

  log(`--- selection: ${selected.length} site(s) due ---`);
  selected.forEach((s, i) => {
    const last = s.scrapingPolicyCheckedAt
      ? s.scrapingPolicyCheckedAt.toISOString().slice(0, 10)
      : "never     ";
    log(`  ${String(i + 1).padStart(3)}  ${last}  ${s.scrapingPolicyStatus.padEnd(26)}  ${s.status.padEnd(6)}  ${s.siteUrl}`);
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
  const runBudgetMs = (policyConfig.maxPolicyFetchSeconds + 60) * 1000;

  log("=== policy sweep --now ===");

  // Scoped to POLICY inside the shared helper, so it can never close a scrape
  // sweep that is genuinely running.
  const stale = await resolveStaleSweeps("POLICY", false, log);
  if (stale > 0) log(`[policy] closed ${stale} stale RUNNING policy sweep(s)`);

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

  const results: PolicySiteResult[] = [];
  let halt: string | null = null;

  /** Record one site: the row and the report item come from the same result. */
  const record = async (r: PolicySiteResult) => {
    results.push(r);
    await prisma.scrapeSweepItem.create({ data: toPolicyItemRow(r, sweep.id) });
  };

  // One site at a time, same resident pattern as the scrape sweep: the worker
  // stays available for manual work, and each result is recorded before the
  // next is queued.
  for (const site of selected) {
    const itemStart = new Date();
    log(`[policy] -> ${site.siteUrl} (${site.scrapingPolicyStatus})`);
    const jobsBefore = await prisma.job.count({ where: { siteId: site.id } });

    const { jobId, alreadyQueued } = await enqueuePolicyReview(site.id, "nightly_sweep");
    if (alreadyQueued) {
      // Someone else's job. Recorded — the row and the report both — and left
      // alone: never waited on, never cancelled.
      log(`[policy] <- skipped_conflict: a POLICY_REVIEW job was already queued (${jobId})`);
      await record({
        siteId: site.id,
        siteUrl: site.siteUrl,
        siteStatus: site.status,
        policyStatusBefore: site.scrapingPolicyStatus,
        policyStatusAfter: site.scrapingPolicyStatus,
        jobsBefore,
        jobsAfter: jobsBefore,
        outcome: decidePolicyOutcome({
          jobEnd: "ALREADY_QUEUED",
          before: site.scrapingPolicyStatus,
          after: site.scrapingPolicyStatus,
        }),
        defect: null,
        startedAt: itemStart,
        finishedAt: new Date(),
      });
      continue;
    }

    const waited = await waitForPolicyJob(
      {
        readJob: () =>
          prisma.workerJob.findUnique({
            where: { id: jobId },
            select: { status: true, startedAt: true },
          }),
        readQueue: () => readQueueState(jobId),
        now: () => Date.now(),
        sleep,
        onWaiting: (reason) => log(`[policy]    waiting: ${reason}`),
      },
      {
        runBudgetMs,
        busyWaitCapMs: BUSY_EVIDENCE_WINDOW_MS,
        pollMs: sweepConfig.pollIntervalMs,
      },
    );

    let defect: string | null = null;

    // Take back only what is still PENDING, by job id. A claimed job belongs to
    // its handler, which writes the site's policy status when it finishes.
    if (waited.end === "WEDGED") {
      const c = await cancelPendingJobById(jobId, "policy sweep cancelled: worker not draining");
      log(`[policy]    drain probe: wedged — ${waited.reason}`);
      if (!c.cancelled) defect = "worker judged not draining, but the job had been claimed; left to its handler";
      halt = "worker not draining";
    } else if (waited.end === "TIMED_OUT") {
      const c = await cancelPendingJobById(
        jobId,
        `policy sweep stopped waiting after ${Math.round(waited.ranForMs / 1000)}s`,
      );
      if (c.leftRunning) {
        log(`[policy]    timed out ${Math.round(waited.ranForMs / 1000)}s after startedAt; the job is still running and is left to its handler`);
      }
    }

    // One read of the site, used for both statuses the result carries.
    const [after, jobsAfter] = await Promise.all([
      prisma.site.findUnique({
        where: { id: site.id },
        select: { status: true, scrapingPolicyStatus: true },
      }),
      prisma.job.count({ where: { siteId: site.id } }),
    ]);
    const policyStatusAfter = after?.scrapingPolicyStatus ?? site.scrapingPolicyStatus;

    const result: PolicySiteResult = {
      siteId: site.id,
      siteUrl: site.siteUrl,
      siteStatus: after?.status ?? site.status,
      policyStatusBefore: site.scrapingPolicyStatus,
      policyStatusAfter,
      jobsBefore,
      jobsAfter,
      outcome: decidePolicyOutcome({
        jobEnd: waited.end,
        before: site.scrapingPolicyStatus,
        after: policyStatusAfter,
      }),
      defect,
      startedAt: itemStart,
      finishedAt: new Date(),
    };

    log(`[policy] <- ${result.outcome}  ${result.policyStatusBefore} -> ${result.policyStatusAfter}`);
    await record(result);

    if (halt) {
      log(`[policy] HALT: ${halt}; ${selected.length - results.length} site(s) not reached`);
      break;
    }

    if (policyConfig.jobDelayMs > 0) await sleep(policyConfig.jobDelayMs);
  }

  // Through the shared close, so the verdict line, the stored logText and the
  // journal are one string, and the counters come from the items.
  const logText = await closeSweep({
    kind: "POLICY",
    sweepId: sweep.id,
    trigger: sweep.trigger,
    startedAt,
    selectedCount: selected.length,
    status: halt ? "FAILED" : "COMPLETED",
    haltReason: halt,
    items: results.map(toPolicyReportItem),
  });

  // Last, so journalctl ends with the whole report.
  log("");
  log(logText);
  return halt || results.some((r) => r.defect) ? 1 : 0;
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
