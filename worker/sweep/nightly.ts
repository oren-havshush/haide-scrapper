// The nightly scrape sweep.
//
// Run:
//   npx tsx worker/sweep/nightly.ts --dry-run          read-only; prints and exits
//   npx tsx worker/sweep/nightly.ts --site <id> --now   one site, then stop
//   npx tsx worker/sweep/nightly.ts --now               the whole fleet
//
// RESIDENT, not fire-and-forget. It enqueues ONE site, waits for that site's
// ScrapeRun to reach a terminal state, records the result, and moves on. Only
// one site is ever in flight, so manual scraping stays available all night, the
// before/after deltas are measured at the right moment, and cancelling means
// cancelling one job rather than unpicking a queue of 145.
//
// It is the only caller that passes `scheduled: true`, which is what suppresses
// every site-mutating write in scrape.ts (worker/lib/scheduledRun.ts). Nothing
// reachable from the HTTP route can set it.
//
// SCRAPE only, never ANALYSIS: an ANALYSIS job rewrites a site's config, so a
// fleet-wide refresh would flatten every hand-built config in one night.
//
// Not yet here, and deliberately: the breaker (step 6) and the rendered report
// (step 7). The seams are marked.

import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { sweepConfig } from "../../src/lib/config";
import { ConflictError } from "../../src/lib/errors";
import { createScrapeRun } from "../../src/services/siteService";
import {
  SWEEP_REAP_OPTIONS,
  reapOrphanedScrapeRuns,
} from "../../src/services/scrapeRunService";
import {
  classifyOutcome,
  isSuccessfulRun,
  selectSitesForSweep,
  SWEEP_SITE_STATUSES,
  type SelectableSite,
} from "../lib/sweepSelection";
import {
  assessDrain,
  BUSY_EVIDENCE_WINDOW_MS,
  HEAD_OF_QUEUE_DEADLINE_MS,
  type DrainVerdict,
} from "../lib/drainProbe";
import { readScheduledFlag } from "../lib/scheduledRun";
import {
  createBreakerState,
  recordOutcome,
  shouldAlertSoftFailures,
  SOFT_FAILURE_ALERT_RATIO,
} from "../lib/sweepBreaker";
import {
  computeCounters,
  renderSweepReport,
  type ReportItem,
  type ReportSweep,
} from "../lib/sweepReport";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

type Mode =
  | { kind: "dry-run" }
  | { kind: "single"; siteId: string }
  | { kind: "fleet" };

function parseArgs(argv: string[]): Mode {
  const dryRun = argv.includes("--dry-run");
  const now = argv.includes("--now");
  const siteIdx = argv.indexOf("--site");
  const siteId = siteIdx >= 0 ? argv[siteIdx + 1] : undefined;

  if (dryRun) return { kind: "dry-run" };
  if (siteId) {
    if (!now) throw new Error("--site requires --now (it runs the scheduled path for real)");
    return { kind: "single", siteId };
  }
  if (now) return { kind: "fleet" };
  throw new Error("one of --dry-run, --now, or --site <id> --now is required");
}

const log = (line: string) => console.info(line);

// ---------------------------------------------------------------------------
// Selection, from the database
// ---------------------------------------------------------------------------

async function loadSelectableSites(): Promise<SelectableSite[]> {
  const sites = await prisma.site.findMany({
    where: { status: { in: [...SWEEP_SITE_STATUSES] } },
    select: { id: true, siteUrl: true, status: true, fieldMappings: true },
  });

  // Last attempt (any outcome) and last success, per site. Read separately
  // because "success" is a definition, not a status — see sweepSelection.ts.
  const runs = await prisma.scrapeRun.findMany({
    where: { siteId: { in: sites.map((s) => s.id) } },
    select: { siteId: true, status: true, failureCategory: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const lastAttempt = new Map<string, Date>();
  const lastSuccess = new Map<string, Date>();
  for (const r of runs) {
    if (r.status === "IN_PROGRESS") continue; // not an outcome yet
    if (!lastAttempt.has(r.siteId)) lastAttempt.set(r.siteId, r.createdAt);
    if (!lastSuccess.has(r.siteId) && isSuccessfulRun(r)) lastSuccess.set(r.siteId, r.createdAt);
  }

  return sites.map((s) => ({
    id: s.id,
    siteUrl: s.siteUrl,
    status: s.status,
    fieldMappings: s.fieldMappings,
    lastAttemptAt: lastAttempt.get(s.id) ?? null,
    lastSuccessAt: lastSuccess.get(s.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

/**
 * Close any ScrapeSweep left RUNNING by a previous night. Without this the
 * dashboard shows a sweep in progress forever, and "is a sweep running?" stops
 * being answerable.
 */
async function resolveStaleSweeps(dryRun: boolean): Promise<number> {
  const stale = await prisma.scrapeSweep.findMany({
    where: { status: "RUNNING" },
    select: { id: true, startedAt: true },
  });
  if (stale.length === 0) return 0;

  if (dryRun) {
    for (const s of stale) {
      log(`  would close stale RUNNING sweep ${s.id} (started ${s.startedAt.toISOString()})`);
    }
    return stale.length;
  }

  await prisma.scrapeSweep.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: {
      status: "FAILED",
      haltReason: "abandoned",
      finishedAt: new Date(),
    },
  });
  return stale.length;
}

/** Facts the drain probe needs, read fresh each poll. */
async function readQueueState(probeJobId: string | null) {
  const now = Date.now();

  const newestInProgress = await prisma.workerJob.findFirst({
    where: { status: "IN_PROGRESS", startedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });

  let probeAtHeadOfQueue = false;
  let probeClaimed = false;
  if (probeJobId) {
    const probe = await prisma.workerJob.findUnique({
      where: { id: probeJobId },
      select: { status: true, createdAt: true },
    });
    probeClaimed = probe != null && probe.status !== "PENDING";
    if (probe && probe.status === "PENDING") {
      const older = await prisma.workerJob.count({
        where: { status: "PENDING", createdAt: { lt: probe.createdAt } },
      });
      probeAtHeadOfQueue = older === 0;
    }
  }

  return {
    newestInProgressAgeMs: newestInProgress?.startedAt
      ? now - newestInProgress.startedAt.getTime()
      : null,
    probeAtHeadOfQueue,
    probeClaimed,
  };
}

/**
 * Prove the worker is claiming jobs, using the FIRST site's job as the probe.
 *
 * This runs on the real path, not only in --dry-run. Without it a sweep against
 * a dead worker enqueues one job, waits out the per-site timeout, moves to the
 * next, and produces a night of perfect silence with a report saying nothing
 * failed — the failure mode the probe exists for.
 *
 * `assessDrain` decides; this only supplies fresh facts and holds the clock.
 * The busy wait is capped at 20 minutes: a job legitimately IN_PROGRESS keeps
 * returning `waiting` forever, and "the worker is busy" stops being a reason to
 * keep waiting once it has been busy longer than the longest scrape can take.
 */
async function probeWorkerDraining(
  probeJobId: string,
  opts: { busyWaitCapMs: number; pollMs: number },
): Promise<DrainVerdict> {
  const started = Date.now();
  let atHeadSince: number | null = null;

  for (;;) {
    const q = await readQueueState(probeJobId);

    // The head-of-queue clock starts when the probe gets there, and resets if
    // something older jumps ahead of it.
    if (q.probeAtHeadOfQueue && atHeadSince === null) atHeadSince = Date.now();
    if (!q.probeAtHeadOfQueue) atHeadSince = null;

    const verdict = assessDrain(
      {
        newestInProgressAgeMs: q.newestInProgressAgeMs,
        probeAtHeadOfQueue: q.probeAtHeadOfQueue,
        probeAtHeadForMs: atHeadSince === null ? null : Date.now() - atHeadSince,
        probeClaimed: q.probeClaimed,
        totalWaitedMs: Date.now() - started,
      },
      { busyWaitCapMs: opts.busyWaitCapMs },
    );

    if (verdict.verdict !== "waiting") return verdict;

    log(`[sweep] drain probe: ${verdict.reason}`);
    await sleep(opts.pollMs);
  }
}

// ---------------------------------------------------------------------------
// Waiting on one site
// ---------------------------------------------------------------------------

type SiteResult = {
  siteId: string;
  siteUrl: string;
  scrapeRunId: string | null;
  outcome: string;
  failureCategory: string | null;
  jobsBefore: number;
  jobsAfter: number;
  newestJobAt: Date | null;
  siteStatus: string;
  wouldDemoteTo: string | null;
  wouldPromoteTo: string | null;
  wouldSkip: string | null;
  /**
   * The ScrapeRun's raw terminal status, kept because `listingsProtected`
   * depends on it and `outcome` cannot answer the question — see the counter's
   * definition in realRun.
   */
  runStatus: string;
  startedAt: Date;
  finishedAt: Date;
  defect: string | null;
  /** Non-null means stop the sweep, with this as the haltReason. */
  halt: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a scheduled run to finish.
 *
 * Waits on BOTH the ScrapeRun and its WorkerJob: a job that dies without
 * touching its run would otherwise leave this polling until the per-site
 * timeout. And a run that flips back to IN_PROGRESS after reaching a terminal
 * state is reported as a defect rather than acted on — that is two writers of
 * terminal state, and acting on it would paper over the thing worth knowing.
 */
async function waitForRun(
  scrapeRunId: string,
  opts: { timeoutMs: number; pollMs: number },
): Promise<{
  status: string;
  failureCategory: string | null;
  jobCount: number;
  defect: string | null;
}> {
  const deadline = Date.now() + opts.timeoutMs;
  let sawTerminal: string | null = null;

  while (Date.now() < deadline) {
    const run = await prisma.scrapeRun.findUnique({
      where: { id: scrapeRunId },
      select: { status: true, failureCategory: true, jobCount: true },
    });

    if (!run) {
      return { status: "MISSING", failureCategory: null, jobCount: 0, defect: "the ScrapeRun row disappeared" };
    }

    if (run.status !== "IN_PROGRESS") {
      sawTerminal = run.status;
      // One more look, to catch a terminal status being written twice.
      await sleep(opts.pollMs);
      const again = await prisma.scrapeRun.findUnique({
        where: { id: scrapeRunId },
        select: { status: true, failureCategory: true, jobCount: true },
      });
      const defect =
        again && again.status === "IN_PROGRESS"
          ? `run flipped back to IN_PROGRESS after reaching ${sawTerminal}`
          : null;
      const final = again ?? run;
      return {
        status: final.status,
        failureCategory: final.failureCategory,
        jobCount: final.jobCount,
        defect,
      };
    }

    // The job may have died without closing its run.
    const job = await prisma.workerJob.findFirst({
      where: { scrapeRunId },
      select: { status: true },
    });
    if (job && (job.status === "FAILED" || job.status === "COMPLETED")) {
      // Give the handler a moment to write the run, then accept reality.
      await sleep(opts.pollMs);
      const run2 = await prisma.scrapeRun.findUnique({
        where: { id: scrapeRunId },
        select: { status: true, failureCategory: true, jobCount: true },
      });
      if (run2 && run2.status === "IN_PROGRESS") {
        return {
          status: "ABANDONED",
          failureCategory: "orphaned",
          jobCount: run2.jobCount,
          defect: `WorkerJob reached ${job.status} while its run stayed IN_PROGRESS`,
        };
      }
      if (run2) {
        return { status: run2.status, failureCategory: run2.failureCategory, jobCount: run2.jobCount, defect: null };
      }
    }

    await sleep(opts.pollMs);
  }

  return {
    status: "TIMED_OUT",
    failureCategory: "timeout",
    jobCount: 0,
    defect: `the sweep stopped waiting after ${Math.round(opts.timeoutMs / 60_000)}m`,
  };
}

async function siteSnapshot(siteId: string) {
  const [site, count, newest] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId }, select: { status: true, siteUrl: true } }),
    prisma.job.count({ where: { siteId } }),
    prisma.job.findFirst({
      where: { siteId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    status: site?.status ?? "<gone>",
    siteUrl: site?.siteUrl ?? "",
    jobCount: count,
    newestJobAt: newest?.createdAt ?? null,
  };
}

/**
 * Take back a job the sweep queued but is no longer waiting for.
 *
 * Used by the wedged probe, by the per-site timeout, and by a breaker halt —
 * all three walk away from a job they created, and a job left behind is not
 * harmless: a PENDING row collides with `worker_job_one_active_per_site_type`
 * the next time anything queues for that site, and a run left IN_PROGRESS
 * blocks the site until the reaper finds it.
 *
 * ONLY a PENDING job is cancelled. If the worker has already claimed it, the
 * handler owns the run's terminal status and will write it when it finishes;
 * closing the run here would be a second writer of terminal state, which is the
 * defect worker/lib/abortToken.ts exists to prevent. The status-scoped
 * updateMany also settles the race where the worker claims the job between the
 * read and the write — count 0 means it was claimed, so the run is left alone.
 */
async function cancelPendingSiteJob(
  scrapeRunId: string,
  reason: string,
): Promise<{ cancelled: boolean; leftRunning: boolean }> {
  const job = await prisma.workerJob.findFirst({
    where: { scrapeRunId },
    select: { id: true, status: true },
  });
  if (!job) return { cancelled: false, leftRunning: false };
  if (job.status === "IN_PROGRESS") return { cancelled: false, leftRunning: true };
  if (job.status !== "PENDING") return { cancelled: false, leftRunning: false };

  const cancelled = await prisma.workerJob.updateMany({
    where: { id: job.id, status: "PENDING" },
    data: { status: "FAILED", error: reason, completedAt: new Date() },
  });
  if (cancelled.count === 0) {
    // Claimed in the gap. The handler owns it now.
    return { cancelled: false, leftRunning: true };
  }

  await prisma.scrapeRun.updateMany({
    where: { id: scrapeRunId, status: "IN_PROGRESS" },
    data: {
      status: "FAILED",
      error: reason,
      // NOT `timeout` or `other`: a job the sweep cancelled is a decision, not
      // evidence about the infrastructure, and must never feed the breaker.
      failureCategory: "cancelled",
      completedAt: new Date(),
    },
  });
  return { cancelled: true, leftRunning: false };
}

/**
 * Wait for the WorkerJob itself to reach a terminal state.
 *
 * The dispatcher writes `result` AFTER the handler returns, and the handler
 * closes the ScrapeRun before returning. So a read taken the moment the run goes
 * terminal can land in that gap and see `result` still null — losing a
 * `wouldDemoteTo` the gate actually withheld, which would be reported as "the
 * nightly changed nothing" when in fact it declined to demote a site.
 */
async function waitForJobTerminal(
  scrapeRunId: string,
  opts: { timeoutMs: number; pollMs: number },
) {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const job = await prisma.workerJob.findFirst({
      where: { scrapeRunId },
      select: { status: true, result: true, payload: true },
    });
    if (!job) return null;
    if (job.status === "COMPLETED" || job.status === "FAILED") return job;
    if (Date.now() > deadline) return job; // report what we have rather than hang
    await sleep(opts.pollMs);
  }
}

async function runOneSite(
  site: { id: string; siteUrl: string },
  opts?: { probe?: (workerJobId: string) => Promise<DrainVerdict> },
): Promise<SiteResult> {
  const startedAt = new Date();
  const before = await siteSnapshot(site.id);

  const base = {
    siteId: site.id,
    siteUrl: site.siteUrl,
    jobsBefore: before.jobCount,
    startedAt,
  };

  let scrapeRunId: string | null = null;
  let defect: string | null = null;

  try {
    const run = await createScrapeRun(site.id, { scheduled: true });
    scrapeRunId = run.id;
  } catch (err) {
    if (err instanceof ConflictError) {
      // An operator is mid-scrape on this site. Record it and move on — never
      // abort the sweep over one busy site.
      const after = await siteSnapshot(site.id);
      return {
        ...base,
        scrapeRunId: null,
        outcome: "skipped_conflict",
        failureCategory: null,
        jobsAfter: after.jobCount,
        newestJobAt: after.newestJobAt,
        siteStatus: after.status,
        wouldDemoteTo: null,
        wouldPromoteTo: null,
        wouldSkip: null,
        runStatus: "NOT_STARTED",
        finishedAt: new Date(),
        defect: null,
        halt: null,
      };
    }
    throw err;
  }

  // Proof of life, on the first site only. The job is already queued, so this
  // probes the real queue with the real work rather than a synthetic ping.
  if (opts?.probe) {
    const enqueued = await prisma.workerJob.findFirst({
      where: { scrapeRunId },
      select: { id: true },
    });
    if (enqueued) {
      const verdict = await opts.probe(enqueued.id);
      log(`[sweep] drain probe: ${verdict.verdict} — ${verdict.reason}`);

      if (verdict.verdict === "wedged") {
        // Take back what we queued, through the shared helper so the wedged
        // path, the per-site timeout and a breaker halt cannot drift apart.
        await cancelPendingSiteJob(scrapeRunId, "sweep cancelled: worker not draining");

        const after = await siteSnapshot(site.id);
        return {
          ...base,
          scrapeRunId,
          outcome: "worker_not_draining",
          failureCategory: "cancelled",
          jobsAfter: after.jobCount,
          newestJobAt: after.newestJobAt,
          siteStatus: after.status,
          wouldDemoteTo: null,
          wouldPromoteTo: null,
          wouldSkip: null,
          runStatus: "FAILED",
          finishedAt: new Date(),
          defect: null,
          halt: "worker not draining",
        };
      }
    }
  }

  const waited = await waitForRun(scrapeRunId, {
    timeoutMs: sweepConfig.perSiteTimeoutMinutes * 60_000,
    pollMs: sweepConfig.pollIntervalMs,
  });
  defect = waited.defect;

  // The sweep gave up waiting. It used to walk away and leave the job behind —
  // a PENDING row that blocks the next queue for this site, or a run stuck
  // IN_PROGRESS. Clean it up on the same terms as everywhere else: cancel only
  // if still PENDING, and leave a claimed job to its handler.
  if (waited.status === "TIMED_OUT") {
    const cleanup = await cancelPendingSiteJob(
      scrapeRunId,
      `sweep stopped waiting after ${sweepConfig.perSiteTimeoutMinutes}m`,
    );
    if (cleanup.leftRunning) {
      defect =
        defect ??
        "the sweep stopped waiting while the worker was still running the job; " +
          "its run will be closed by the handler";
    }
  }

  // Only now read the gate's verdict: the dispatcher writes `result` after the
  // handler has already closed the run.
  const job = await waitForJobTerminal(scrapeRunId, {
    timeoutMs: 60_000,
    pollMs: sweepConfig.pollIntervalMs,
  });
  const result = (job?.result ?? {}) as Record<string, unknown>;
  const withheld = (result.withheld ?? {}) as Record<string, unknown>;

  if (job && !readScheduledFlag(job.payload)) {
    defect = defect ?? "the sweep's own job did not carry scheduled:true";
  }

  const wouldSkip = typeof withheld.wouldSkip === "string" ? withheld.wouldSkip : null;
  const after = await siteSnapshot(site.id);

  return {
    ...base,
    scrapeRunId,
    // A withheld SKIP is its own outcome. Selection excludes applyRequiresLogin
    // sites, so this only fires when the flag was set between selection and the
    // run — rare, and exactly the kind of thing a report should not swallow.
    outcome: wouldSkip
      ? "withheld_skip"
      : classifyOutcome({ status: waited.status, failureCategory: waited.failureCategory }),
    failureCategory: waited.failureCategory,
    jobsAfter: after.jobCount,
    newestJobAt: after.newestJobAt,
    siteStatus: after.status,
    wouldDemoteTo: typeof withheld.wouldDemoteTo === "string" ? withheld.wouldDemoteTo : null,
    wouldPromoteTo: typeof withheld.wouldPromoteTo === "string" ? withheld.wouldPromoteTo : null,
    wouldSkip,
    runStatus: waited.status,
    finishedAt: new Date(),
    defect,
    halt: null,
  };
}

/**
 * Close the sweep: counters, report, and the row — on BOTH paths.
 *
 * Shared deliberately. The halt path used to assemble its own subset inline and
 * wrote zeros for wouldHaveDemoted, wouldHavePromoted and listingsProtected —
 * the three numbers that say what the gate saved, missing from exactly the
 * nights something went wrong. Computing them in one place, from the items,
 * makes that impossible rather than merely fixed.
 */
async function closeSweep(args: {
  sweepId: string;
  trigger: string;
  startedAt: Date;
  selectedCount: number;
  status: "COMPLETED" | "HALTED";
  haltReason: string | null;
  results: SiteResult[];
}): Promise<string> {
  const finishedAt = new Date();

  const sweepRow: ReportSweep = {
    id: args.sweepId,
    kind: "SCRAPE",
    status: args.status,
    trigger: args.trigger,
    startedAt: args.startedAt,
    finishedAt,
    selectedCount: args.selectedCount,
    haltReason: args.haltReason,
  };

  const items: ReportItem[] = args.results.map((r) => ({
    siteId: r.siteId,
    siteUrl: r.siteUrl,
    phase: "scrape",
    outcome: r.outcome,
    failureCategory: r.failureCategory,
    jobsBefore: r.jobsBefore,
    jobsAfter: r.jobsAfter,
    newestJobAt: r.newestJobAt,
    siteStatus: r.siteStatus,
    wouldDemoteTo: r.wouldDemoteTo,
    wouldPromoteTo: r.wouldPromoteTo,
    // In-memory only. The dashboard re-reads items from the database, which has
    // no defect column — but it displays this stored logText, so the defect
    // lines survive there.
    defect: r.defect,
  }));

  const counters = computeCounters(sweepRow, items);
  const logText = renderSweepReport(sweepRow, items, { timeZone: sweepConfig.timezone });

  await prisma.scrapeSweep.update({
    where: { id: args.sweepId },
    data: {
      status: args.status,
      finishedAt,
      ...(args.status === "HALTED"
        ? { haltedAt: finishedAt, haltReason: args.haltReason }
        : {}),
      ...counters,
      logText,
    },
  });

  return logText;
}

// ---------------------------------------------------------------------------
// Dry run — READ ONLY
// ---------------------------------------------------------------------------

/**
 * Writes nothing. No WorkerJob, no ScrapeRun, no ScrapeSweep row, no site
 * change — not even the stale-sweep resolution, which is reported as "would
 * close" instead. It exists so the selection, the ordering and the pre-flight
 * verdicts can be read against production before anything is enqueued.
 */
async function dryRun(): Promise<number> {
  const now = new Date();
  log(`=== nightly sweep --dry-run (READ ONLY) ===`);
  log(`time         ${now.toISOString()}  (${sweepConfig.timezone})`);
  log(`enabled      ${sweepConfig.enabled}`);
  log(`fresh window ${sweepConfig.freshWindowHours}h`);
  log(`per-site cap ${sweepConfig.perSiteTimeoutMinutes}m, runtime cap ${sweepConfig.maxRuntimeMinutes}m`);
  log("");

  log("--- pre-flight (verdicts only; nothing is written) ---");

  const orphanCandidates = await prisma.scrapeRun.count({ where: { status: "IN_PROGRESS" } });
  log(`  IN_PROGRESS scrape runs: ${orphanCandidates}  (the reaper would inspect these)`);

  const staleSweeps = await resolveStaleSweeps(true);
  log(`  stale RUNNING sweeps:    ${staleSweeps}`);

  const queue = await readQueueState(null);
  const active = await prisma.workerJob.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } });
  log(`  active worker jobs:      ${active}`);
  log(
    `  newest IN_PROGRESS:      ${
      queue.newestInProgressAgeMs === null
        ? "none"
        : `${Math.round(queue.newestInProgressAgeMs / 60_000)}m ago`
    }`,
  );
  const wouldBe = assessDrain({
    newestInProgressAgeMs: queue.newestInProgressAgeMs,
    probeAtHeadOfQueue: active === 0,
    probeAtHeadForMs: 0,
    probeClaimed: false,
  });
  log(`  drain probe would start: ${wouldBe.verdict} — ${wouldBe.reason}`);
  log(
    `  (busy window ${BUSY_EVIDENCE_WINDOW_MS / 60_000}m, head-of-queue deadline ${HEAD_OF_QUEUE_DEADLINE_MS / 1000}s)`,
  );
  log("");

  const sites = await loadSelectableSites();
  const { selected, excluded } = selectSitesForSweep(sites, {
    now,
    freshWindowMs: sweepConfig.freshWindowHours * 3_600_000,
  });

  log(`--- selection: ${selected.length} of ${sites.length} ACTIVE/REVIEW sites ---`);
  log("   #  last attempt          last success          status  site");
  selected.forEach((s, i) => {
    const att = s.lastAttemptAt ? s.lastAttemptAt.toISOString().slice(0, 16) : "never           ";
    const suc = s.lastSuccessAt ? s.lastSuccessAt.toISOString().slice(0, 16) : "never           ";
    log(`  ${String(i + 1).padStart(3)}  ${att}      ${suc}      ${s.status.padEnd(6)}  ${s.siteUrl}`);
  });

  log("");
  log(`--- excluded: ${excluded.length} ---`);
  const byReason = new Map<string, number>();
  for (const e of excluded) {
    const key = e.reason.replace(/\d+h ago, inside the \d+h window/, "inside the fresh window");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${String(n).padStart(3)}  ${reason}`);
  }
  for (const e of excluded) {
    if (!e.reason.includes("window")) log(`       - ${e.site.siteUrl}: ${e.reason}`);
  }

  log("");
  log(`--- ordering: by last ATTEMPT, oldest first (never by last success) ---`);
  log(`--- nothing was written. Exiting. ---`);
  return 0;
}

// ---------------------------------------------------------------------------
// Real runs
// ---------------------------------------------------------------------------

async function realRun(mode: Mode): Promise<number> {
  if (!sweepConfig.enabled) {
    log("[sweep] SWEEP_ENABLED=false — refusing to run.");
    return 0;
  }

  const single = mode.kind === "single" ? mode.siteId : null;
  const now = new Date();

  log(`=== nightly sweep ${single ? `--site ${single}` : "--now"} ===`);

  // --- pre-flight ------------------------------------------------------
  const reaped = await reapOrphanedScrapeRuns(SWEEP_REAP_OPTIONS);
  if (reaped.reaped > 0) {
    log(`[sweep] reaped ${reaped.reaped} orphaned run(s) of ${reaped.scanned} scanned`);
    for (const d of reaped.details) log(`[sweep]   ${d.siteId}: ${d.reason}`);
  }
  const stale = await resolveStaleSweeps(false);
  if (stale > 0) log(`[sweep] closed ${stale} stale RUNNING sweep row(s) as abandoned`);

  const sweep = await prisma.scrapeSweep.create({
    data: {
      kind: "SCRAPE",
      trigger: single ? "manual-single" : "manual",
      status: "RUNNING",
      startedAt: now,
    },
  });
  log(`[sweep] sweep row ${sweep.id}`);

  // --- what to run -----------------------------------------------------
  let queue: SelectableSite[];
  if (single) {
    const all = await loadSelectableSites();
    const found = all.find((s) => s.id === single);
    if (!found) {
      await prisma.scrapeSweep.update({
        where: { id: sweep.id },
        data: { status: "FAILED", haltReason: `site ${single} not found or not ACTIVE/REVIEW`, finishedAt: new Date() },
      });
      log(`[sweep] site ${single} is not an ACTIVE/REVIEW site. Nothing to do.`);
      return 1;
    }
    // --site deliberately bypasses the freshness window — it is for verifying
    // one named site on demand, not for deciding what is due.
    queue = [found];
    log(`[sweep] single-site mode: ${found.siteUrl}`);
  } else {
    const { selected } = selectSitesForSweep(await loadSelectableSites(), {
      now,
      freshWindowMs: sweepConfig.freshWindowHours * 3_600_000,
    });
    queue = selected;
    log(`[sweep] selected ${queue.length} site(s)`);
  }

  await prisma.scrapeSweep.update({
    where: { id: sweep.id },
    data: { selectedCount: queue.length },
  });

  // --- the loop --------------------------------------------------------
  const results: SiteResult[] = [];
  // Per-sweep, so tomorrow starts clean whatever happened tonight.
  let breaker = createBreakerState();
  const deadline = now.getTime() + sweepConfig.maxRuntimeMinutes * 60_000;

  for (const site of queue) {
    if (Date.now() > deadline) {
      log(`[sweep] runtime cap reached; ${queue.length - results.length} site(s) not reached`);
      break;
    }

    log(`[sweep] -> ${site.siteUrl}`);

    // The FIRST site's job is the probe. Nothing else is enqueued until it has
    // shown the worker is claiming work — otherwise a sweep against a dead
    // worker times out site after site and reports a quiet, successful night.
    const isProbe = results.length === 0;
    const result = await runOneSite(
      site,
      isProbe
        ? {
            probe: (jobId) =>
              probeWorkerDraining(jobId, {
                busyWaitCapMs: BUSY_EVIDENCE_WINDOW_MS,
                pollMs: sweepConfig.pollIntervalMs,
              }),
          }
        : undefined,
    );
    results.push(result);

    log(
      `[sweep] <- ${result.outcome}` +
        (result.failureCategory ? ` (${result.failureCategory})` : "") +
        ` jobs ${result.jobsBefore} -> ${result.jobsAfter}` +
        ` site ${result.siteStatus}` +
        (result.wouldPromoteTo ? ` WOULD PROMOTE -> ${result.wouldPromoteTo}` : "") +
        (result.wouldDemoteTo ? ` WOULD DEMOTE -> ${result.wouldDemoteTo}` : ""),
    );
    if (result.defect) log(`[sweep] !! DEFECT: ${result.defect}`);

    await prisma.scrapeSweepItem.create({
      data: {
        sweepId: sweep.id,
        siteId: result.siteId,
        phase: "scrape",
        scrapeRunId: result.scrapeRunId,
        outcome: result.outcome,
        failureCategory: result.failureCategory,
        jobsBefore: result.jobsBefore,
        jobsAfter: result.jobsAfter,
        newestJobAt: result.newestJobAt,
        siteStatus: result.siteStatus,
        wouldDemoteTo: result.wouldDemoteTo,
        wouldPromoteTo: result.wouldPromoteTo,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      },
    });

    if (result.halt) {
      log(`[sweep] HALT: ${result.halt}`);
      await prisma.scrapeSweep.update({
        where: { id: sweep.id },
        data: {
          status: "FAILED",
          haltReason: result.halt,
          haltedAt: new Date(),
          finishedAt: new Date(),
          selectedCount: queue.length,
        },
      });
      log(`[sweep] stopped after the probe; ${queue.length - results.length} site(s) not reached`);
      return 1;
    }

    // --- the breaker ---------------------------------------------------
    //
    // `lastSuccessAt` is the site's last success BEFORE tonight, which is what
    // qualifies a hard failure: only a site that worked recently and now fails
    // is evidence about the infrastructure rather than about itself.
    breaker = recordOutcome(breaker, {
      siteUrl: site.siteUrl,
      outcome: result.outcome,
      lastSuccessAt: site.lastSuccessAt,
      now: new Date(),
    });

    if (breaker.halted) {
      // The site that tripped it already has its item written above — the night
      // must keep the row that explains why it stopped.
      //
      // Nothing is normally in flight here: the driver waits for each site
      // before moving on. The exception is a site that TIMED_OUT, where the job
      // may still be running; cancelPendingSiteJob cancels only a PENDING job
      // and reports a claimed one instead of racing its handler.
      let haltReason = breaker.haltReason ?? "breaker tripped";
      if (result.scrapeRunId) {
        const cleanup = await cancelPendingSiteJob(
          result.scrapeRunId,
          `sweep halted: ${haltReason}`,
        );
        if (cleanup.cancelled) haltReason += " — in-flight job cancelled";
        if (cleanup.leftRunning) {
          haltReason += " — in-flight job left running to finish";
        }
      }

      log(`[sweep] HALT: ${haltReason}`);
      const haltedText = await closeSweep({
        sweepId: sweep.id,
        trigger: sweep.trigger,
        startedAt: sweep.startedAt,
        selectedCount: queue.length,
        status: "HALTED",
        haltReason,
        results,
      });
      // Printed last so the journal carries the whole report, verdict line
      // included — `journalctl -u haide-nightly` is the durable copy.
      log("");
      log(haltedText);
      return 1;
    }
  }

  // --- close out -------------------------------------------------------
  // Counters and report both come from closeSweep, so this path and the halt
  // path cannot compute them differently.
  const reportText = await closeSweep({
    sweepId: sweep.id,
    trigger: sweep.trigger,
    startedAt: sweep.startedAt,
    selectedCount: queue.length,
    status: "COMPLETED",
    haltReason: null,
    results,
  });

  if (breaker.hardUnqualified > 0) {
    log(
      `  ${breaker.hardUnqualified} hard failure(s) on long-broken sites — counted, ` +
        `never halting; this is the manual-review queue`,
    );
  }

  // Never a halt. Above this share the signature stops being per-site config
  // death and starts looking like a shared ATS re-theme or an IP block.
  if (shouldAlertSoftFailures(breaker)) {
    log(
      `  ALERT: ${breaker.softTotal}/${breaker.attempted} sites returned empty or ` +
        `unusable results (> ${SOFT_FAILURE_ALERT_RATIO * 100}%) — check for a shared ` +
        `cause rather than ${breaker.softTotal} separate ones`,
    );
  }

  // Last, so `journalctl -u haide-nightly` ends with the whole report and the
  // verdict line is the same text the sweep row holds.
  log("");
  log(reportText);

  return results.some((r) => r.defect) ? 1 : 0;
}

// ---------------------------------------------------------------------------

async function main() {
  const mode = parseArgs(process.argv.slice(2));
  const code = mode.kind === "dry-run" ? await dryRun() : await realRun(mode);
  await prisma.$disconnect();
  process.exit(code);
}

main().catch(async (err) => {
  console.error("[sweep] fatal:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
