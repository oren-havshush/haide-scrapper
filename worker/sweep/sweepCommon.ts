// What both sweeps share: closing a sweep, proving the worker drains, taking
// back a job the sweep will not wait for, and clearing stale RUNNING rows.
//
// These lived in nightly.ts, and policy.ts grew its own copies — an inline close,
// no probe, no cancel. Each copy was a place the two sweeps could come to mean
// different things by "closed", "wedged" or "cancelled". There is one of each now.

import { prisma } from "../../src/lib/prisma";
import { sweepConfig } from "../../src/lib/config";
import { createDrainTracker, type DrainVerdict, type QueueFacts } from "../lib/drainProbe";
import {
  computeCounters,
  renderSweepReport,
  sweepDate,
  type ReportItem,
  type ReportSweep,
  type SkippedSite,
} from "../lib/sweepReport";
import { sendSweepMail, type MailOutcome } from "../lib/sweepMail";

export type SweepKind = "SCRAPE" | "POLICY";

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Stale RUNNING rows
// ---------------------------------------------------------------------------

/**
 * Close any sweep of THIS kind left RUNNING by an earlier run. Without this the
 * dashboard shows a sweep in progress for ever.
 *
 * Scoped by kind. Unscoped, a manual `nightly.ts --site … --now` run at 06:30
 * would close the policy sweep that was genuinely running as "abandoned".
 */
export async function resolveStaleSweeps(
  kind: SweepKind,
  dryRun: boolean,
  log: (line: string) => void,
): Promise<number> {
  const stale = await prisma.scrapeSweep.findMany({
    where: { status: "RUNNING", kind },
    select: { id: true, startedAt: true },
  });
  if (stale.length === 0) return 0;

  if (dryRun) {
    for (const s of stale) {
      log(`  would close stale RUNNING ${kind} sweep ${s.id} (started ${s.startedAt.toISOString()})`);
    }
    return stale.length;
  }

  await prisma.scrapeSweep.updateMany({
    where: { id: { in: stale.map((s) => s.id) }, status: "RUNNING" },
    data: {
      status: "FAILED",
      haltReason: "abandoned",
      finishedAt: new Date(),
    },
  });
  return stale.length;
}

// ---------------------------------------------------------------------------
// Is the worker draining?
// ---------------------------------------------------------------------------

/** Facts the drain probe needs, read fresh each poll. */
export async function readQueueState(probeJobId: string | null): Promise<QueueFacts> {
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
 * Wait until the probe job is claimed, or the drain rules call the worker
 * wedged. The rules and their clocks are createDrainTracker's; this only reads
 * the queue and sleeps.
 *
 * The busy wait is capped: a job legitimately IN_PROGRESS keeps returning
 * `waiting` for ever, and "the worker is busy" stops being a reason to wait once
 * it has been busy longer than the longest scrape can take.
 */
export async function probeWorkerDraining(
  probeJobId: string,
  opts: { busyWaitCapMs: number; pollMs: number; log: (line: string) => void },
): Promise<DrainVerdict> {
  const tracker = createDrainTracker(Date.now(), { busyWaitCapMs: opts.busyWaitCapMs });

  for (;;) {
    const verdict = tracker.observe(await readQueueState(probeJobId), Date.now());
    if (verdict.verdict !== "waiting") return verdict;

    opts.log(`drain probe: ${verdict.reason}`);
    await sleep(opts.pollMs);
  }
}

// ---------------------------------------------------------------------------
// Taking back a job
// ---------------------------------------------------------------------------

/**
 * Cancel a WorkerJob by id — ONLY if it is still PENDING.
 *
 * A claimed job belongs to its handler, which writes its terminal state; a
 * second writer here is the defect worker/lib/abortToken.ts exists to prevent.
 * The write is status-scoped, which also settles the race where the worker
 * claims the job between any read and this write: count 0 means it was claimed
 * (or already finished), and nothing is touched.
 */
export async function cancelPendingJobById(
  jobId: string,
  reason: string,
): Promise<{ cancelled: boolean; leftRunning: boolean }> {
  const cancelled = await prisma.workerJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "FAILED", error: reason, completedAt: new Date() },
  });
  if (cancelled.count > 0) return { cancelled: true, leftRunning: false };

  // Not cancelled. Say whether that is because a handler holds it.
  const now = await prisma.workerJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return { cancelled: false, leftRunning: now?.status === "IN_PROGRESS" };
}

// ---------------------------------------------------------------------------
// Closing a sweep
// ---------------------------------------------------------------------------

/**
 * Close the sweep: counters, report, and the row — on EVERY path, for BOTH kinds.
 *
 * The halt path once assembled its own subset inline and wrote zeros for the
 * gate counters on exactly the nights something went wrong; the policy sweep
 * then grew a second inline close of its own. Counters and report come from
 * the items here, once.
 *
 * Returns the report text so the caller prints it last: `journalctl` then ends
 * with the same string the row holds.
 */
/** A ScrapeSweep row update, as closeSweep issues it. */
export type SweepRowUpdate = { where: { id: string }; data: Record<string, unknown> };

/** closeSweep's side effects, injectable so a test can watch them without a database. */
export type CloseSweepDeps = {
  update?: (a: SweepRowUpdate) => Promise<unknown>;
  send?: (a: { kind: SweepKind; date: string; logText: string; items: ReportItem[] }) => Promise<MailOutcome>;
};

export async function closeSweep(args: {
  kind: SweepKind;
  sweepId: string;
  trigger: string;
  startedAt: Date;
  selectedCount: number;
  status: "COMPLETED" | "HALTED" | "FAILED";
  haltReason: string | null;
  items: ReportItem[];
  /** Selection exclusions, named in the report's Ran section. Scrape sweep only. */
  skipped?: SkippedSite[];
  /** The night's detail mode, for the report's Details section. Scrape sweep only. */
  detailMode?: "full" | "incremental";
}, deps: CloseSweepDeps = {}): Promise<string> {
  const update = deps.update ?? ((a: SweepRowUpdate) => prisma.scrapeSweep.update(a));
  const send = deps.send ?? ((a: Parameters<typeof sendSweepMail>[0]) => sendSweepMail(a));
  const finishedAt = new Date();

  const sweepRow: ReportSweep = {
    id: args.sweepId,
    kind: args.kind,
    status: args.status,
    trigger: args.trigger,
    startedAt: args.startedAt,
    finishedAt,
    selectedCount: args.selectedCount,
    haltReason: args.haltReason,
  };

  const counters = computeCounters(sweepRow, args.items);
  const logText = renderSweepReport(sweepRow, args.items, {
    timeZone: sweepConfig.timezone,
    skipped: args.skipped,
    detailMode: args.detailMode,
    // The thresholds the worker's undersize guard read, so the report's drop
    // rule is the same rule.
    dropThresholds: {
      minPrevious: sweepConfig.dropMinPrevious,
      keepRatio: sweepConfig.dropKeepRatio,
    },
  });

  await update({
    where: { id: args.sweepId },
    data: {
      status: args.status,
      finishedAt,
      ...(args.status !== "COMPLETED"
        ? { haltedAt: finishedAt, haltReason: args.haltReason }
        : {}),
      ...counters,
      logText,
    },
  });

  // The report by email (worker/lib/sweepMail.ts), both sweep kinds. AFTER the
  // row above is written, so the report is safe whatever the mail does. The
  // sender never throws by contract; the try is for the contract being broken,
  // and the emailStatus write has its own, because a mail must never cost the
  // night its closed sweep.
  let emailStatus: string;
  try {
    const mail = await send({
      kind: args.kind,
      date: sweepDate(args.startedAt, sweepConfig.timezone),
      logText,
      items: args.items,
    });
    emailStatus = mail.emailStatus;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mail] !! report NOT emailed — the sender threw: ${msg}`);
    emailStatus = `failed: sender threw — ${msg}`.slice(0, 500);
  }
  try {
    await update({ where: { id: args.sweepId }, data: { emailStatus } });
  } catch (err) {
    console.error(`[mail] could not record emailStatus "${emailStatus}": ${err instanceof Error ? err.message : String(err)}`);
  }

  return logText;
}
